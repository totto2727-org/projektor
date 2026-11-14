import { fileURLToPath } from 'node:url'

import cloudflare from '@alchemy.run/cloudflare-runtime/vite'
import { defineConfig } from 'vite-plus'

import applicationConfig from '../../vite.config'
import { deployment } from '../../worker-graph'
import { applicationTextBindings, foreignRateLimiterBinding } from './api-host'
import { inlineCoreBinding } from './inline-api'
import { makePreviewContext } from './runtime-context'

// The official test-only host wraps the application's own Effront plugins.
// Web and API use native bindings to the same private Core artifact.
// Both adapters lack business storage. Only API retains the official OAuth protocol KV.
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
        compatibilityDate: deployment.frontend.compatibility.date,
        compatibilityFlags: deployment.frontend.compatibility.flags,
        viteEnvironments: { entry: 'rsc', children: ['ssr'] },
        worker: {
          name: 'projektor-e2e-frontend',
          bindings: [...applicationTextBindings, inlineCoreBinding, foreignRateLimiterBinding],
        },
      }),
    ],
  }
})
