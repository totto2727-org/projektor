declare module 'virtual:fixture-migrations' {
  const migrations: readonly {
    readonly name: string
    readonly queries: readonly string[]
    readonly hash: string
  }[]
  export default migrations
}

declare module 'virtual:production-core-entrypoint' {
  const entrypoint: typeof import('../../core').default
  export default entrypoint
}
