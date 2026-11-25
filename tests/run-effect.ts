import { Effect, Iterable } from 'effect'

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

const FIRST_FIXTURE_INDEX = 0

/**
 * Await a fixed number of setup steps in index order.
 *
 * @param {number} count The number of steps to run.
 * @param {(index: number) => Promise<void>} step The asynchronous step for each index.
 */
export const runIndexedInOrder = async function runIndexedInOrder(
  count: number,
  step: (index: number) => Promise<void>,
): Promise<void> {
  await runInOrder(Iterable.take(Iterable.range(FIRST_FIXTURE_INDEX), count), step)
}
