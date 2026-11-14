import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { expect, it } from 'vite-plus/test'

import { loadMigrations } from './helpers'

it('appends review status without selecting or changing populated historical attachments', () => {
  const db = new DatabaseSync(':memory:')
  const migration = readFileSync(
    new URL('../../../migrations/0069_attachment_review_status.sql', import.meta.url),
    'utf8',
  )
  try {
    db.exec('PRAGMA foreign_keys=ON')
    for (const sql of loadMigrations()) {
      if (sql === migration) break
      db.exec(sql)
    }
    db.exec(`
      INSERT INTO users (id,email,name,created_at) VALUES ('u','review@example.test','User',1);
      INSERT INTO workspaces (id,name,slug,created_at) VALUES ('w','Workspace','workspace',1);
      INSERT INTO attachments (id,workspace_id,kind,r2_key,filename,content_type,size,url,entity_type,entity_id,created_by_id,created_at) VALUES
        ('file','w','file','w/file','file.pdf','application/pdf',12,NULL,'issue','i','u',1),
        ('url','w','url','','Design','',0,'https://example.test','issue','i','u',2),
        ('wiki','w','wiki_ref','','Wiki','',0,NULL,'issue','i','u',3);
    `)
    const before = db.prepare('SELECT * FROM attachments ORDER BY id').all()
    db.exec(migration)
    expect(db.prepare('SELECT * FROM attachments ORDER BY id').all()).toEqual(
      before.map((row) => ({ ...row, review_status: null })),
    )
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  } finally {
    db.close()
  }
})
