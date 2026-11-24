import type { Env as ProjektorEnv } from '#types'

// Describe the bindings used by the native test API Worker.
declare global {
  namespace Cloudflare {
    interface Env extends ProjektorEnv {}
  }
}
