declare module 'virtual:fixture-migrations' {
  type Migration = Readonly<{
    name: string
    queries: Readonly<string[]>
    hash: string
  }>

  const migrations: Readonly<Migration[]>
  export default migrations
}
