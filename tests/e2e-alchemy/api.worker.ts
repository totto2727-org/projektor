import api from '../../src/api/index'
import { MIGRATIONS } from '../../src/api/test/migrations'

// Preserve the real Worker's DO exports and scheduled handler. The only adapter
// work is applying the maintained schema to this host's empty temporary D1.
export { RateLimiter, WorkspaceHub } from '../../src/api/index'
let ready: Promise<void> | undefined

export default {
  async fetch(...args: Parameters<typeof api.fetch>) {
    const [, env] = args
    ready ??= (async () => {
      for (const sql of MIGRATIONS) {
        // Same statement convention as the maintained API test setup.
        for (const statement of sql
          .replace(/--[^\n]*/g, '')
          .split(';')
          .map((part: string) => part.trim())
          .filter(Boolean)) {
          await env.DB.prepare(statement).run()
        }
      }
    })()
    await ready
    return api.fetch(...args)
  },
  scheduled: api.scheduled,
}
