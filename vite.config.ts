import { effrontAlchemy } from '@effront/alchemy/cloudflare/vite'
import { effrontTailwind } from '@effront/tailwind'
import { effront } from '@effront/vite'
import { generateIgnorePatterns } from '@totto2727/gitignore-patterns'
import lintPreset from '@totto2727/oxlint/preset/application'
import { defineConfig } from 'vite-plus'

import { nativeWorkerProject } from './tests/native-workers/project.ts'
import { deployment } from './worker-graph.ts'

const ignorePatterns = await generateIgnorePatterns(new URL('.', import.meta.url))

// oxlint-disable-next-line import/no-default-export -- Vite loads its configuration from the default export.
export default defineConfig({
  fmt: {
    arrowParens: 'always',
    experimentalSortImports: { ignoreCase: true, newlinesBetween: true, order: 'asc' },
    experimentalSortPackageJson: true,
    ignorePatterns,
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
        env: { node: true },
        files: [
          '*.ts',
          'src/api/test-node/**/*.ts',
          'tests/**/*.config.ts',
          'tests/e2e-alchemy/inline-api.ts',
          'tests/e2e-alchemy/runtime-context.ts',
          'tests/native-workers/options.ts',
          'tests/native-workers/project.ts',
        ],
      },
      {
        env: { serviceworker: true },
        files: [
          'src/api/**/*.ts',
          'src/core/**/*.ts',
          'src/db/**/*.ts',
          'src/services/**/*.ts',
          'tests/**/*.worker.ts',
          'tests/native-workers/**/*.test.ts',
          'workers/**/*.ts',
        ],
      },
      {
        env: { browser: true },
        files: ['src/web/**/*.ts', 'src/web/**/*.tsx', 'tests/e2e-alchemy/**/*.e2e.ts'],
      },
      {
        env: { node: true },
        files: ['src/web/**/*.test.ts', 'src/web/**/*.test.tsx'],
      },
      { files: ['src/api/lib/wiki-ssr.ts'], globals: { HTMLRewriter: 'readonly' } },
      {
        files: ['src/api/realtime/workspace-hub.ts', 'src/api/test/realtime.test.ts'],
        globals: { WebSocketPair: 'readonly' },
      },
      { files: ['src/api/routes/mcp.ts'], globals: { __PROJEKTOR_VERSION__: 'readonly' } },
    ],
  },
  plugins: [
    effront({ application: './src/web/entry.effront.tsx' }),
    effrontAlchemy({ worker: deployment.frontend.main }),
    ...effrontTailwind({ stylesheet: './src/web/styles/app.css' }),
  ],
  resolve: { tsconfigPaths: true },
  run: {
    tasks: {
      check: 'vp check',
      ci: { command: '', dependsOn: ['check', 'test'] },
      deploy: { cache: false, command: 'alchemy deploy --config alchemy.run.ts --stage production' },
      dev: { cache: false, command: 'alchemy dev --config alchemy.run.ts' },
      e2e: { cache: false, command: 'playwright test --config tests/e2e-alchemy/playwright.config.ts' },
      fix: 'vp check --fix',
      plan: { cache: false, command: 'alchemy plan --config alchemy.run.ts --stage production' },
      test: 'vp test run',
      'test:workers': 'vp test run --project workers',
    },
  },
  test: {
    projects: [
      { extends: false, ...nativeWorkerProject },
      {
        extends: false,
        resolve: { tsconfigPaths: true },
        test: {
          dir: 'src/web',
          environment: 'node',
          name: 'web',
          restoreMocks: true,
          server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },
        },
      },
      {
        extends: false,
        resolve: { tsconfigPaths: true },
        test: {
          environment: 'node',
          include: ['*.test.ts', 'src/api/test-node/**/*.test.ts', 'src/{core,db,services}/**/*.test.ts'],
          name: 'node',
        },
      },
    ],
  },
})
