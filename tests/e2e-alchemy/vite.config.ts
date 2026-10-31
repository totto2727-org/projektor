import { fileURLToPath } from 'node:url'

import cloudflare from '@alchemy.run/cloudflare-runtime/vite'
import { defineConfig } from 'vite-plus'

import applicationConfig from '../../vite.config'
import { sharedApplicationBindings } from './api-host'
import { inlineApiRateLimiterBinding } from './inline-api'
import { makePreviewContext } from './runtime-context'

// The official test-only host wraps the application's own Effront plugins.
// Web authenticates and executes commands directly against shared local resources.
// Only the foreign RateLimiter namespace points at the separate actual API Worker.
export default defineConfig(async (environment) => {
  const preview = await makePreviewContext(environment.isPreview)
  const application = applicationConfig
  return {
    ...application,
    root: fileURLToPath(new URL('../../', import.meta.url)),
    plugins: [
      preview?.lifecycle,
      application.plugins,
      cloudflare({
        context: preview?.context,
        compatibilityDate: '2026-09-01',
        compatibilityFlags: ['nodejs_compat'],
        viteEnvironments: { entry: 'rsc', children: ['ssr'] },
        worker: {
          name: 'projektor-e2e-frontend',
          bindings: [...sharedApplicationBindings, inlineApiRateLimiterBinding],
        },
      }),
    ],
  }
})
