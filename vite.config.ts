import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { effrontAlchemy } from '@effront/alchemy/cloudflare/vite'
import { effrontTailwind } from '@effront/tailwind'
import { effront } from '@effront/vite'
import { defineConfig } from 'vite-plus'
import { configDefaults } from 'vite-plus/test/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Runtime Markdown's dependencies must not emit Node createRequire shims.
  environments: { ssr: { build: { rolldownOptions: { platform: 'neutral' } } } },
  plugins: [
    effront({ application: './src/web/entry.effront.tsx' }),
    effrontAlchemy({ worker: './alchemy.ts' }),
    ...effrontTailwind({ stylesheet: './src/web/styles/app.css' }),
  ],
  run: {
    tasks: {
      ci: { command: '', dependsOn: ['check', 'test'] },
      check: 'vp check',
      fix: 'vp check --fix',
      // Cloudflare pool 0.22 supports Vitest 4, while Vite+ 1.1 bundles Vitest 5.
      // Preserve native regressions explicitly until upstream support lands.
      // Real Worker browser acceptance is the separate `vp run e2e` workflow.
      test: 'vp test run --project api-node --project web --project data',
      'test:workers': 'vp test run --project workers',
      dev: { command: 'alchemy dev --config alchemy.run.ts', cache: false },
      plan: { command: 'alchemy plan --config alchemy.run.ts --stage production', cache: false },
      deploy: { command: 'alchemy deploy --config alchemy.run.ts --stage production', cache: false },
      e2e: { command: 'playwright test --config tests/e2e-alchemy/playwright.config.ts', cache: false },
    },
  },
  fmt: {
    arrowParens: 'always',
    experimentalSortImports: { ignoreCase: true, newlinesBetween: true, order: 'asc' },
    experimentalSortPackageJson: true,
    jsxSingleQuote: true,
    printWidth: 120,
    proseWrap: 'preserve',
    semi: false,
    singleQuote: true,
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    projects: [
      {
        extends: false,
        plugins: [
          cloudflareTest({
            main: './src/api/index.ts',
            miniflare: {
              compatibilityDate: '2024-09-23',
              compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public', 'cache_option_enabled'],
              d1Databases: ['DB'],
              kvNamespaces: ['KV', 'OAUTH_KV'],
              r2Buckets: ['R2'],
              durableObjects: { RATE_LIMITER: { className: 'RateLimiter', useSQLite: true } },
              bindings: {
                ENVIRONMENT: 'development',
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
          }),
        ],
        test: {
          name: 'workers',
          include: ['src/api/**/*.test.ts'],
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
          include: ['src/db/**/*.test.ts', 'src/services/tests/*.test.ts', 'alchemy.test.ts'],
        },
      },
    ],
  },
})
