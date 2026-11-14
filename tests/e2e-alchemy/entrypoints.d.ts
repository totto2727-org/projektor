declare module 'virtual:production-api-entrypoint' {
  const entrypoint: typeof import('../../src/api/index').default
  export default entrypoint
  export const RateLimiter: typeof import('../../src/api/index').RateLimiter
  export const WorkspaceHub: typeof import('../../src/api/index').WorkspaceHub
}

declare module 'virtual:production-core-entrypoint' {
  const entrypoint: typeof import('../../workers/core').default
  export default entrypoint
}
