import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import cloudflare from '@alchemy.run/cloudflare-runtime/vite'
import { readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vite-plus'

import { deployment } from '../../worker-graph'
import { coreWorkerOptions } from './api-host'

/** Compile official-parser migration records into the acceptance-only Core artifact. */
export default defineConfig(async (environment) => {
  if (environment.isPreview) throw new Error('Core runs only inside the single three-Worker acceptance preview.')
  const migrations = (await readD1Migrations(fileURLToPath(new URL('../../migrations/', import.meta.url)))).map(
    (migration) => ({
      ...migration,
      hash: createHash('sha256').update(JSON.stringify(migration.queries)).digest('hex'),
    }),
  )
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    publicDir: false,
    plugins: [
      {
        name: 'projektor-e2e-core-fixture-migrations',
        resolveId: (id) => (id === 'virtual:fixture-migrations' ? '\0virtual:fixture-migrations' : undefined),
        load: (id) =>
          id === '\0virtual:fixture-migrations' ? `export default ${JSON.stringify(migrations)}` : undefined,
      },
      cloudflare({
        main: './core.worker.ts',
        compatibilityDate: deployment.core.compatibility.date,
        compatibilityFlags: deployment.core.compatibility.flags,
        worker: coreWorkerOptions,
      }),
    ],
    build: { outDir: 'core-dist' },
  }
})
