import type { Env as ProjektorEnv } from '#types'

// Describe the bindings used by the native test API Worker.
declare global {
  namespace Cloudflare {
    // oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- The platform merges this interface with Cloudflare.Env to expose the test Worker bindings.
    interface Env extends ProjektorEnv {}
  }
}
