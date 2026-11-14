import { builtinModules } from 'node:module'

import { cloudflareTest, getRunnerName } from '@cloudflare/vitest-plugin'
import { effrontAlchemy } from '@effront/alchemy/cloudflare/vite'
import { effrontTailwind } from '@effront/tailwind'
import { effront } from '@effront/vite'
import { generateIgnorePatterns } from '@totto2727/gitignore-patterns'
import { defineConfig } from 'vite-plus'
import { configDefaults } from 'vite-plus/test/config'

import { nativeCoreWorker } from './tests/native-workers/options'
import { deployment } from './worker-graph'

const ignorePatterns = await generateIgnorePatterns(new URL('.', import.meta.url))
let nativeRunnerName = ''

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    effront({ application: './src/web/entry.effront.tsx' }),
    effrontAlchemy({ worker: deployment.frontend.main }),
    ...effrontTailwind({ stylesheet: './src/web/styles/app.css' }),
  ],
  run: {
    tasks: {
      ci: { command: '', dependsOn: ['check', 'test'] },
      check: 'vp check',
      fix: 'vp check --fix',
      test: 'vp test run',
      'test:workers': 'vp test run --project workers',
      dev: { command: 'alchemy dev --config alchemy.run.ts', cache: false },
      plan: { command: 'alchemy plan --config alchemy.run.ts --stage production', cache: false },
      deploy: { command: 'alchemy deploy --config alchemy.run.ts --stage production', cache: false },
      e2e: { command: 'playwright test --config tests/e2e-alchemy/playwright.config.ts', cache: false },
    },
  },
  fmt: {
    ignorePatterns,
    arrowParens: 'always',
    experimentalSortImports: { ignoreCase: true, newlinesBetween: true, order: 'asc' },
    experimentalSortPackageJson: true,
    jsxSingleQuote: true,
    printWidth: 120,
    proseWrap: 'preserve',
    semi: false,
    singleQuote: true,
  },
  lint: { ignorePatterns, options: { typeAware: true, typeCheck: true } },
  test: {
    projects: [
      {
        extends: false,
        plugins: [
          {
            name: 'projektor-native-core-topology',
            configureVitest({ project }) {
              nativeRunnerName = getRunnerName(project)
            },
          },
          cloudflareTest(async () => ({
            main: './tests/native-workers/api.worker.ts',
            miniflare: {
              compatibilityDate: '2024-09-23',
              compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public', 'cache_option_enabled'],
              serviceBindings: { CORE: 'projektor-native-core' },
              kvNamespaces: { OAUTH_KV: 'projektor-native-oauth' },
              workers: [await nativeCoreWorker(nativeRunnerName)],
              durableObjects: {
                RATE_LIMITER: { className: 'RateLimiter', useSQLite: true },
                // Native regression fixture only. Production keeps this optional hub unbound.
                FIXTURE_WORKSPACE_HUB: { className: 'WorkspaceHub', useSQLite: true },
              },
              bindings: {
                CORE_FIXTURE_CONFIGURATION: '{}',
                ENVIRONMENT: 'development',
                CF_ACCESS_TEAM_DOMAIN: '',
                CF_ACCESS_AUDIENCE: '',
                DEV_USER_EMAIL: '',
                JWT_SECRET: 'test-secret-do-not-use-in-production',
                BOOTSTRAP_SECRET: 'test-bootstrap-secret-do-not-use-in-production',
                RATE_LIMIT_AUTH_MAX: '3',
                RATE_LIMIT_API_MAX: '5',
                RATE_LIMIT_WINDOW_SECS: '60',
                RATE_LIMIT_AUTH_FAIL_MAX: '3',
                RATE_LIMIT_FEEDBACK_MAX: '5',
                RATE_LIMIT_FEEDBACK_IP_MAX: '5',
                BRAND_NAME: 'Test Brand',
                BRAND_ACCENT: '#123456',
              },
            },
          })),
        ],
        test: {
          name: 'workers',
          // The public SDK barrel includes deployment providers. Prebundle only the
          // application's named runtime exports so real Workers execute the same
          // tree-shaken native RPC client as production, without provider imports.
          deps: {
            optimizer: {
              ssr: {
                enabled: true,
                include: ['projektor/core-client'],
                exclude: ['effect'],
                rolldownOptions: { external: [...builtinModules, /^node:/, /^cloudflare:/] },
              },
            },
          },
          include: ['src/api/**/*.test.ts', 'tests/native-workers/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/api/**/*.node.test.ts'],
          setupFiles: ['./src/api/test/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      { extends: false, test: { name: 'api-node', environment: 'node', include: ['src/api/**/*.node.test.ts'] } },
      {
        extends: false,
        resolve: { tsconfigPaths: true },
        test: {
          name: 'web',
          environment: 'node',
          include: ['src/web/**/*.test.ts', 'src/web/**/*.test.tsx'],
          restoreMocks: true,
          server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
        },
      },
      {
        extends: false,
        test: {
          name: 'data',
          environment: 'node',
          include: ['src/db/**/*.test.ts', 'src/services/tests/*.test.ts', 'src/core/**/*.test.ts', 'alchemy.test.ts'],
        },
      },
    ],
  },
})
