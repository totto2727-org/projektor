import { defineConfig } from 'vite-plus'

import { makeCoreFixtureConfig } from '#tests/e2e-alchemy/core.vite.config.ts'

// oxlint-disable-next-line import/no-default-export -- Vite loads the native Core build configuration from the default export.
export default defineConfig(() => makeCoreFixtureConfig('../native-workers/core.worker.ts', '../native-workers/.build'))
