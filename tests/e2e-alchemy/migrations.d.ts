declare module 'virtual:fixture-migrations' {
  const migrations: readonly {
    readonly name: string
    readonly queries: readonly string[]
    readonly hash: string
  }[]
  export default migrations
}
