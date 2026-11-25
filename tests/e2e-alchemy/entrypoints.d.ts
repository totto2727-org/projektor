declare module 'virtual:production-api-entrypoint' {
  import type ApiWorker from '#api/worker.ts'
  import type { RateLimiter as ApiRateLimiter, WorkspaceHub as ApiWorkspaceHub } from '#api/worker.ts'

  const entrypoint: typeof ApiWorker
  export default entrypoint
  export const RateLimiter: typeof ApiRateLimiter
  export const WorkspaceHub: typeof ApiWorkspaceHub
}

declare module 'virtual:production-core-entrypoint' {
  const entrypoint: typeof import('../../workers/core').default
  export default entrypoint
}
