// oxlint-disable-next-line rules/no-node-imports -- Vite must externalize the builtin modules of the Node runtime that runs it.
import { builtinModules } from 'node:module'

import { cloudflareTest, getRunnerName } from '@cloudflare/vitest-plugin'
import { MutableRef } from 'effect'
import { defineProject } from 'vite-plus/test/config'

import { nativeCoreWorker } from './options.ts'

const nativeRunnerName = MutableRef.make('')
const workerTestTimeoutMs = 30_000

export const nativeWorkerProject = defineProject({
  plugins: [
    {
      configureVitest({ project }) {
        MutableRef.set(nativeRunnerName, getRunnerName(project))
      },
      name: 'projektor-native-core-topology',
    },
    cloudflareTest(async () => ({
      main: './tests/native-workers/api.worker.ts',
      miniflare: {
        bindings: {
          BOOTSTRAP_SECRET: 'test-bootstrap-secret-do-not-use-in-production',
          BRAND_ACCENT: '#123456',
          BRAND_NAME: 'Test Brand',
          CF_ACCESS_AUDIENCE: '',
          CF_ACCESS_TEAM_DOMAIN: '',
          CORE_FIXTURE_CONFIGURATION: '{}',
          DEV_USER_EMAIL: '',
          ENVIRONMENT: 'development',
          JWT_SECRET: 'test-secret-do-not-use-in-production',
          RATE_LIMIT_API_MAX: '5',
          RATE_LIMIT_AUTH_FAIL_MAX: '3',
          RATE_LIMIT_AUTH_MAX: '3',
          RATE_LIMIT_FEEDBACK_IP_MAX: '5',
          RATE_LIMIT_FEEDBACK_MAX: '5',
          RATE_LIMIT_WINDOW_SECS: '60',
        },
        compatibilityDate: '2024-09-23',
        compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public', 'cache_option_enabled'],
        durableObjects: {
          // Native regression fixture only. Production keeps this optional hub unbound.
          FIXTURE_WORKSPACE_HUB: { className: 'WorkspaceHub', useSQLite: true },
          RATE_LIMITER: { className: 'RateLimiter', useSQLite: true },
        },
        kvNamespaces: { OAUTH_KV: 'projektor-native-oauth' },
        serviceBindings: { CORE: 'projektor-native-core' },
        workers: [await nativeCoreWorker(MutableRef.get(nativeRunnerName))],
      },
    })),
  ],
  test: {
    /*
     * The public SDK barrel includes deployment providers. Prebundle only the
     * application's named runtime exports so real Workers execute the same
     * tree-shaken native RPC client as production, without provider imports.
     */
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          exclude: ['effect'],
          include: ['projektor/core-client'],
          rolldownOptions: { external: [...builtinModules, /^node:/u, /^cloudflare:/u] },
        },
      },
    },
    hookTimeout: workerTestTimeoutMs,
    include: ['src/api/test/**/*.test.ts', 'tests/native-workers/**/*.test.ts'],
    name: 'workers',
    setupFiles: ['./src/api/test/setup.ts'],
    testTimeout: workerTestTimeoutMs,
  },
})
