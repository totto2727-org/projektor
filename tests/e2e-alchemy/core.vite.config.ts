import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import cloudflare from '@alchemy.run/cloudflare-runtime/vite'
import { readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig, type UserConfig } from 'vite-plus'

import { deployment } from '../../worker-graph'
import { coreWorkerOptions } from './api-host'

/** Compile official-parser migration records into the acceptance-only Core artifact. */
export async function makeCoreFixtureConfig(main: string, outDir: string): Promise<UserConfig> {
  const migrations = (await readD1Migrations(fileURLToPath(new URL('../../migrations/', import.meta.url)))).map(
    (migration) => ({
      ...migration,
      hash: createHash('sha256').update(JSON.stringify(migration.queries)).digest('hex'),
    }),
  )
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    publicDir: false,
    resolve: {
      alias: {
        'virtual:production-core-entrypoint': fileURLToPath(
          new URL(deployment.core.main, new URL('../../', import.meta.url)),
        ),
      },
    },
    plugins: [
      {
        name: 'projektor-e2e-core-fixture-migrations',
        resolveId: (id) => (id === 'virtual:fixture-migrations' ? '\0virtual:fixture-migrations' : undefined),
        load: (id) =>
          id === '\0virtual:fixture-migrations' ? `export default ${JSON.stringify(migrations)}` : undefined,
      },
      cloudflare({
        main,
        compatibilityDate: deployment.core.compatibility.date,
        compatibilityFlags: deployment.core.compatibility.flags,
        worker: coreWorkerOptions,
      }),
    ],
    build: { outDir },
  }
}

export default defineConfig(async (environment) => {
  if (environment.isPreview) throw new Error('Core runs only inside the single three-Worker acceptance preview.')
  return makeCoreFixtureConfig('./core.worker.ts', 'core-dist')
})
