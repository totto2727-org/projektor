import { Effect, Iterable } from 'effect'
import { vi } from 'vite-plus/test'
import type { Mock } from 'vite-plus/test'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'
import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { loadMigrations } from '#db/test/helpers.ts'
import { runTestEffect } from '#tests/run-effect.ts'
import { makeRequestServices } from '@/request.ts'
import type { ScopeOptions } from '@/server/server-context.ts'
import { createTestResources, testEnvironment } from '@/server/test/resources.ts'
import { createTestDatabase } from '@/test/database.ts'

export type WikiActionDatabase = ReturnType<typeof createTestDatabase>

export interface WikiActionOptions {
  origin?: string
  pageProject?: string
  inaccessible?: boolean
  archived?: boolean
  role?: 'owner' | 'admin' | 'member' | 'viewer'
  granted?: boolean
  auth?: 'dev' | 'public' | 'pk'
}

const installWikiMigrations = function installWikiMigrations(database: WikiActionDatabase): void {
  // The shared relational fixture skips FTS-dependent migrations for portability.
  // Wiki commands exercise real FTS5 here using those exact maintained statements.
  Iterable.forEach(loadMigrations(), (migration) => {
    Iterable.forEach(migration.replaceAll(/--[^\n]*/gu, '').split(';'), (statement) => {
      if (/\b[wW][iI][kK][iI]_[fF][tT][sS](?:_[nN][eE][wW])?\b/u.test(statement)) {
        database.sqlite.exec(statement)
      }
    })
  })
}

const prepareWikiDatabase = function prepareWikiDatabase(
  database: WikiActionDatabase,
  options: WikiActionOptions,
): void {
  installWikiMigrations(database)
  database.sqlite.exec(`
    INSERT INTO workspaces (id,name,slug,created_at) VALUES ('workspace','Team','team',1),('foreign-workspace','Foreign','foreign',1);
    INSERT INTO users (id,email,name,created_at) VALUES ('user','alice@example.test','Alice',1),('other-user','other@example.test','Other',1);
    INSERT INTO workspace_members (workspace_id,user_id,role,joined_at) VALUES ('workspace','user','member',1);
    INSERT INTO projects (id,workspace_id,name,key,slug,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000002','workspace','Source','SRC','source',1,1);
    INSERT INTO wiki_pages (id,workspace_id,slug,title,content,created_by_id,updated_by_id,created_at,updated_at) VALUES
      ('00000000-0000-4000-8000-000000000001','workspace','guide','Guide','Body','user','user',1,1),('foreign-page','foreign-workspace','guide','Foreign Guide','Secret','user','user',1,1);
    INSERT INTO wiki_revisions (id,page_id,content,author_id,created_at) VALUES ('revision','00000000-0000-4000-8000-000000000001','Body','user',1),('foreign-revision','foreign-page','Secret','user',1);
  `)
  if (isNonEmptyText(options.pageProject)) {
    database.sqlite
      .prepare("UPDATE wiki_pages SET project_id = ? WHERE id = '00000000-0000-4000-8000-000000000001'")
      .run(options.pageProject)
  }
  if (options.archived === true) {
    database.sqlite.exec("UPDATE projects SET archived_at = 2 WHERE id = '00000000-0000-4000-8000-000000000002'")
  }
  if (isNonEmptyText(options.role)) {
    database.sqlite.prepare("UPDATE workspace_members SET role = ? WHERE user_id = 'user'").run(options.role)
  }
  if (
    options.granted === true ||
    (isNonEmptyText(options.pageProject) && options.archived !== true && options.inaccessible !== true)
  ) {
    database.sqlite.exec(`
      INSERT INTO user_groups (id,workspace_id,name,created_at) VALUES ('group','workspace','Readers',1);
      INSERT INTO user_group_members (group_id,user_id,added_by,added_at) VALUES ('group','user','user',1);
      INSERT INTO group_project_grants (group_id,project_id,role) VALUES ('group','00000000-0000-4000-8000-000000000002','member');
    `)
  }
}

type WikiRequestServices = Effect.Success<ReturnType<typeof makeRequestServices>>

const wikiActionServices = function wikiActionServices(
  native: WikiRequestServices,
  options: WikiActionOptions,
  invalidate: () => void,
): WikiRequestServices {
  const resolveScope = function resolveScope(selection?: ScopeOptions): ReturnType<WikiRequestServices['scope']> {
    return native
      .scope(selection)
      .pipe(
        Effect.map((scope) =>
          options.auth === 'public' || options.auth === 'pk'
            ? { ...scope, auth: { kind: 'human' as const, method: options.auth } }
            : scope,
        ),
      )
  }
  const markInvalidated = Effect.sync(invalidate)
  const invalidateAfterRequest = native.invalidate.pipe(Effect.andThen(markInvalidated))
  return {
    ...native,
    ...fieldsInOrder([
      ['scope', resolveScope],
      ['invalidate', invalidateAfterRequest],
    ]),
  }
}

interface WikiActionEnvironment {
  database: WikiActionDatabase
  invalidate: Mock<() => void>
  resources: ReturnType<typeof createTestResources>
  services: WikiRequestServices
}

/**
 * Prepares the real SQLite, request context and resources for a Wiki action test.
 *
 * @param {WikiActionDatabase[]} databases Databases closed by the calling suite.
 * @param {WikiActionOptions} options Workspace, identity and visibility fixture options.
 * @returns {Promise<WikiActionEnvironment>} The prepared action environment.
 */
export const createWikiActionEnvironment = async function createWikiActionEnvironment(
  databases: WikiActionDatabase[],
  options: WikiActionOptions,
): Promise<WikiActionEnvironment> {
  const database = createTestDatabase()
  databases.push(database)
  prepareWikiDatabase(database, options)

  const resources = createTestResources()
  const invalidate = vi.fn<() => void>()
  const request = new Request('https://app.test/_effront/function', {
    headers: { Origin: options.origin ?? 'https://app.test' },
    method: 'POST',
  })
  const bindings = fieldsInOrder([
    ['KV', resources.kv],
    ['R2', resources.r2],
    ['OAUTH_KV', resources.oauthKv],
  ])
  const environment = testEnvironment(database.db, 'alice@example.test', bindings)
  const native = await runTestEffect(makeRequestServices(request, environment))
  return { database, invalidate, resources, services: wikiActionServices(native, options, invalidate) }
}
