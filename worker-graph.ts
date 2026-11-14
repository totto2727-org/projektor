import { apiOrigin } from './src/deployment'

/** Nonsecret production identities shared by deployment and the native acceptance graph. */
export const deployment = {
  accountId: '5643a837ef66765e7881c0831a36ebed',
  api: {
    name: 'projektor',
    hostname: 'projektor-api.totto2727.dev',
    origin: apiOrigin,
    main: './src/api/index.ts',
    compatibility: {
      date: '2024-09-23',
      flags: ['nodejs_compat', 'global_fetch_strictly_public', 'cache_option_enabled'],
    },
    crons: ['0 3 * * *'],
  },
  frontend: {
    name: 'projektor-frontend',
    hostname: 'projektor.totto2727.dev',
    origin: 'https://projektor.totto2727.dev',
    compatibility: { date: '2026-09-01', flags: ['nodejs_compat'] },
  },
  core: {
    name: 'projektor-core',
    main: './src/core/entry.ts',
    compatibility: { date: '2026-09-01', flags: ['nodejs_compat'] },
  },
  storage: {
    database: { id: 'e852f9c2-e817-409e-bbf0-3168e82a1afc', name: 'projektor' },
    cache: { id: 'b5598fbbbc2e48e3beab8bf9aecfc4bd', title: 'projektor' },
    oauth: { id: 'b187546f271142419343787032f6ca9b', title: 'projektor-oauth' },
    files: { name: 'projektor-files' },
  },
  access: {
    teamDomain: 'totto2727.cloudflareaccess.com',
    audience: '327e65a1c53f85fa45155ffe4b7e1e8c35740cce3efc70b1f161392f5144ddb9',
    domain: 'projektor.totto2727.dev',
  },
}
