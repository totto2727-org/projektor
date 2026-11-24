import { builtinModules } from 'node:module'

import { cloudflareTest, getRunnerName } from '@cloudflare/vitest-plugin'
import { effrontAlchemy } from '@effront/alchemy/cloudflare/vite'
import { effrontTailwind } from '@effront/tailwind'
import { effront } from '@effront/vite'
import { generateIgnorePatterns } from '@totto2727/gitignore-patterns'
import lintPreset from '@totto2727/oxlint/preset/application'
import { defineConfig } from 'vite-plus'

import { nativeCoreWorker } from './tests/native-workers/options.ts'
import { deployment } from './worker-graph.ts'

const ignorePatterns = await generateIgnorePatterns(new URL('.', import.meta.url))
let nativeRunnerName = ''

// oxlint-disable-next-line import/no-default-export -- Vite loads its configuration from the default export.
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
  lint: {
    extends: [lintPreset],
    ignorePatterns,
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: [
          '*.ts',
          'src/api/test-node/**/*.ts',
          'tests/**/*.config.ts',
          'tests/e2e-alchemy/inline-api.ts',
          'tests/e2e-alchemy/runtime-context.ts',
          'tests/native-workers/options.ts',
        ],
        env: { node: true },
      },
      {
        files: [
          'src/api/**/*.ts',
          'src/core/**/*.ts',
          'src/db/**/*.ts',
          'src/services/**/*.ts',
          'tests/**/*.worker.ts',
          'tests/native-workers/**/*.test.ts',
          'workers/**/*.ts',
        ],
        env: { serviceworker: true },
      },
      {
        files: ['src/web/**/*.ts', 'src/web/**/*.tsx', 'tests/e2e-alchemy/**/*.e2e.ts'],
        env: { browser: true },
      },
      {
        files: ['src/web/**/*.test.ts', 'src/web/**/*.test.tsx'],
        env: { node: true },
      },
      { files: ['src/api/lib/wiki-ssr.ts'], globals: { HTMLRewriter: 'readonly' } },
      {
        files: ['src/api/realtime/workspace-hub.ts', 'src/api/test/realtime.test.ts'],
        globals: { WebSocketPair: 'readonly' },
      },
      { files: ['src/api/routes/mcp.ts'], globals: { __PROJEKTOR_VERSION__: 'readonly' } },
    ],
  },
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
          /*
           * The public SDK barrel includes deployment providers. Prebundle only the
           * application's named runtime exports so real Workers execute the same
           * tree-shaken native RPC client as production, without provider imports.
           */
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
          include: ['src/api/test/**/*.test.ts', 'tests/native-workers/**/*.test.ts'],
          setupFiles: ['./src/api/test/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: false,
        resolve: { tsconfigPaths: true },
        test: {
          name: 'web',
          environment: 'node',
          dir: 'src/web',
          restoreMocks: true,
          server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
        },
      },
      {
        extends: false,
        resolve: { tsconfigPaths: true },
        test: {
          name: 'node',
          environment: 'node',
          include: ['*.test.ts', 'src/api/test-node/**/*.test.ts', 'src/{core,db,services}/**/*.test.ts'],
        },
      },
    ],
  },
})
