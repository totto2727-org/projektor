import { afterEach, describe, expect, it } from 'vite-plus/test'

import { seedDefaultCustomFields } from '#commands/custom-fields'
import { createWorkspace } from '#commands/workspaces'

import { createTestDatabase } from '../../web/test/database'

const databases: ReturnType<typeof createTestDatabase>[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

function fixture() {
  const database = createTestDatabase()
  databases.push(database)
  // The node fixture omits FTS5. This mirror checks provisioning writes, not search behavior.
  database.sqlite.exec(`CREATE TABLE wiki_fts (page_id TEXT, workspace_id TEXT, title TEXT, content TEXT, tags TEXT);
    INSERT INTO users (id,email,name,created_at) VALUES ('u','u@example.test','User',1);`)
  let batches = 0
  // Model D1 batch atomicity explicitly: the general node fixture uses Promise.all.
  const db = new Proxy(database.db, {
    get(target, key) {
      if (key !== 'batch') return Reflect.get(target, key)
      return async (statements: D1PreparedStatement[]) => {
        batches++
        database.sqlite.exec('BEGIN')
        try {
          const results = []
          for (const statement of statements) results.push(await statement.all())
          database.sqlite.exec('COMMIT')
          return results
        } catch (error) {
          database.sqlite.exec('ROLLBACK')
          throw error
        }
      }
    },
  })
  const count = (table: string) => database.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n
  return { ...database, db, count, batches: () => batches }
}

describe('atomic workspace provisioning', () => {
  it('creates ownership and complete default configuration in one batch', async () => {
    const f = fixture()
    const workspace = await createWorkspace(f.db, 'u', { name: 'Workspace', slug: 'workspace' })
    expect(f.batches()).toBe(1)
    expect(f.count('workspaces')).toBe(1)
    expect(
      f.sqlite.prepare('SELECT user_id,role FROM workspace_members WHERE workspace_id=?').get(workspace.id),
    ).toMatchObject({ user_id: 'u', role: 'owner' })
    expect(f.count('task_types')).toBe(4)
    expect(f.count('task_statuses')).toBe(6)
    expect(f.count('custom_field_definitions')).toBe(1)
    expect(f.count('wiki_pages')).toBe(4)
    expect(f.count('wiki_fts')).toBe(1)
    await seedDefaultCustomFields(f.db, workspace.id)
    await seedDefaultCustomFields(f.db, workspace.id)
    expect(f.count('custom_field_definitions')).toBe(1)
  })

  it('rolls back every earlier seed when a late wiki template fails and permits retry', async () => {
    const f = fixture()
    f.sqlite.exec(`CREATE TRIGGER fail_template BEFORE INSERT ON wiki_pages WHEN NEW.is_template=1
      BEGIN SELECT RAISE(ABORT,'template failure'); END;`)
    await expect(createWorkspace(f.db, 'u', { name: 'Workspace', slug: 'workspace' })).rejects.toThrow(
      'template failure',
    )
    for (const table of [
      'workspaces',
      'workspace_members',
      'task_types',
      'task_statuses',
      'custom_field_definitions',
      'wiki_pages',
      'wiki_fts',
    ]) {
      expect(f.count(table), table).toBe(0)
    }
    f.sqlite.exec('DROP TRIGGER fail_template')
    await expect(createWorkspace(f.db, 'u', { name: 'Workspace', slug: 'workspace' })).resolves.toMatchObject({
      slug: 'workspace',
    })
    expect(f.count('workspaces')).toBe(1)
  })

  it('does not leave a tenant when its owner does not exist', async () => {
    const f = fixture()
    await expect(createWorkspace(f.db, 'missing', { name: 'Workspace', slug: 'workspace' })).rejects.toThrow()
    expect(f.count('workspaces')).toBe(0)
    expect(f.count('workspace_members')).toBe(0)
  })
})
