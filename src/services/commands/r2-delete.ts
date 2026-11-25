import { Array, Predicate } from 'effect'

const R2_DELETE_BATCH_SIZE = 1000

// R2 limits one delete request to 1,000 keys. Each batch settles before the next starts.
export const deleteR2Keys = async function deleteR2Keys(
  bucket: R2Bucket,
  keys: Readonly<string[]>,
  reportFailure?: (error: unknown, batch: Readonly<string[]>) => void,
): Promise<void> {
  const batches = Array.chunksOf(keys, R2_DELETE_BATCH_SIZE)
  await Array.reduce(batches, Promise.resolve(), async (previous, batch): Promise<void> => {
    await previous
    try {
      await bucket.delete(batch)
    } catch (error) {
      if (Predicate.isNullish(reportFailure)) {
        throw error
      }
      reportFailure(error, batch)
    }
  })
}
