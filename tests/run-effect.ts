import { Effect } from 'effect'

export const runTestEffect: typeof Effect.runPromise = (program, options) => {
  // oxlint-disable-next-line rules/no-effect-runtime-run -- Vitest awaits a JavaScript promise at the test boundary.
  return Effect.runPromise(program, options)
}

export const runInOrder = async function runInOrder<Item>(
  items: globalThis.Iterable<Item>,
  step: (item: Item) => Promise<void>,
): Promise<void> {
  const sequence = Effect.forEach(items, (item) => Effect.promise(async () => step(item)), {
    concurrency: 1,
    discard: true,
  })
  await runTestEffect(sequence)
}
