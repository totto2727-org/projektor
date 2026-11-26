import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, test } from 'vite-plus/test'

import { SQL_NULL } from '#db/sql-null.ts'
import { sqliteRowFields, sqliteRowsFields } from '#tests/sqlite-records.ts'

import { loadMigrations } from './helpers.ts'

describe('covers attachment review target migration', () => {
  test('appends review status without selecting or changing populated historical attachments', () => {
    const db = new DatabaseSync(':memory:')
    const migration = readFileSync(
      new URL('../../../migrations/0069_attachment_review_status.sql', import.meta.url),
      'utf8',
    )
    try {
      db.exec('PRAGMA foreign_keys=ON')
      for (const sql of loadMigrations()) {
        if (sql === migration) {
          break
        }
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
      expect(sqliteRowsFields(db.prepare('SELECT * FROM attachments ORDER BY id').all())).toStrictEqual(
        before.map((row) => ({ ...row, review_status: SQL_NULL })),
      )
      expect(db.prepare('PRAGMA foreign_key_check').all()).toStrictEqual([])
      expect(sqliteRowFields(db.prepare('PRAGMA integrity_check').get())).toStrictEqual({ integrity_check: 'ok' })
    } finally {
      db.close()
    }
  })
})
