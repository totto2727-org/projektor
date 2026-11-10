import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { deployment } from '../../worker-graph'

const execute = promisify(execFile)
const buildDirectory = fileURLToPath(new URL('./.build/ssr/', import.meta.url))
let building: Promise<void> | undefined

function prepareCoreArtifact(): Promise<void> {
  // Parallel native suites share one compilation, never concurrent output writers.
  building ??= execute('vp', ['build', '--config', fileURLToPath(new URL('./core.vite.config.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    maxBuffer: 16 * 1024 * 1024,
  })
    .then(() => undefined)
    .catch((error: unknown) => {
      building = undefined
      throw error
    })
  return building
}

/** Compile the same official native Core bridge used by production and browser acceptance. */
export async function nativeCoreWorker(runnerName: string) {
  if (!runnerName) throw new Error('The native API runner must be initialized before its Core service.')
  await prepareCoreArtifact()
  const entries = await readdir(buildDirectory, { recursive: true, withFileTypes: true })
  const modules = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.endsWith('.map'))
      .map(async (entry) => {
        const path = join(entry.parentPath, entry.name)
        const extension = extname(path)
        const type =
          extension === '.js' || extension === '.mjs'
            ? ('ESModule' as const)
            : extension === '.cjs'
              ? ('CommonJS' as const)
              : extension === '.wasm'
                ? ('CompiledWasm' as const)
                : extension === '.json' || extension === '.txt'
                  ? ('Text' as const)
                  : undefined
        if (!type) throw new Error(`Unsupported native Core build artifact: ${path}`)
        return { type, path, contents: await readFile(path) }
      }),
  )
  modules.sort((a, b) => Number(b.path.endsWith('/core.worker.js')) - Number(a.path.endsWith('/core.worker.js')))
  if (!modules[0]?.path.endsWith('/core.worker.js')) throw new Error('The official native Core artifact is missing.')
  return {
    name: 'projektor-native-core',
    modules,
    modulesRoot: buildDirectory,
    compatibilityDate: deployment.core.compatibility.date,
    compatibilityFlags: [...deployment.core.compatibility.flags],
    d1Databases: { DB: 'projektor-native-db' },
    kvNamespaces: { KV: 'projektor-native-kv', OAUTH_KV: 'projektor-native-oauth' },
    r2Buckets: { R2: 'projektor-native-r2' },
    durableObjects: { RATE_LIMITER: { className: 'RateLimiter', scriptName: runnerName } },
    bindings: {
      ENVIRONMENT: 'development',
      CF_ACCESS_TEAM_DOMAIN: '',
      CF_ACCESS_AUDIENCE: '',
      DEV_USER_EMAIL: '',
      BOOTSTRAP_SECRET: 'test-bootstrap-secret-do-not-use-in-production',
      ALCHEMY_STACK_NAME: 'projektor-e2e',
      ALCHEMY_STAGE: 'test',
    },
  }
}
