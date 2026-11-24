declare module 'virtual:fixture-migrations' {
  const migrations: Readonly<
    {
      readonly name: string
      readonly queries: Readonly<string[]>
      readonly hash: string
    }[]
  >
  export default migrations
}
