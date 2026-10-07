import { fileURLToPath } from 'node:url'

import * as D1 from '@alchemy.run/cloudflare-runtime/core/bindings/d1/D1'
import * as Text from '@alchemy.run/cloudflare-runtime/core/bindings/Text'
import cloudflare from '@alchemy.run/cloudflare-runtime/vite'
import { defineConfig } from 'vite-plus'

import applicationConfig from '../../vite.config'
import { inlineApiBinding } from './inline-api'
import { makePreviewContext } from './runtime-context'

// The official test-only host wraps the application's own Effront plugins.
// API_BASE is deliberately not a reachable network origin: successful protected
// rendering requires the native API service binding, not a public fetch fallback.
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
          bindings: [
            D1.local({ binding: 'DB', id: 'projektor-e2e-db' }),
            Text.local('ALCHEMY_STACK_NAME', 'projektor-e2e'),
            Text.local('ALCHEMY_STAGE', 'test'),
            Text.local('API_BASE', 'https://projektor-e2e-api.invalid'),
            inlineApiBinding,
          ],
        },
      }),
    ],
  }
})
