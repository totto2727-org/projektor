import { Effect } from 'effect'

export const runTestEffect: typeof Effect.runPromise = (program, options) => {
  // oxlint-disable-next-line rules/no-effect-runtime-run -- Vitest awaits a JavaScript promise at the test boundary.
  return Effect.runPromise(program, options)
}
