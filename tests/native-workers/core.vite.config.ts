import { defineConfig } from 'vite-plus'

import { makeCoreFixtureConfig } from '../e2e-alchemy/core.vite.config'

export default defineConfig(() => makeCoreFixtureConfig('../native-workers/core.worker.ts', '../native-workers/.build'))
