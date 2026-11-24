/** Stable identities for immutable query inputs, including repeated name/value pairs. */
export const queryFields = function queryFields(
  search: string,
  omitted: Readonly<string[]> = [],
): { name: string; value: string; key: string }[] {
  const occurrences = new Map<string, number>()
  return [...new URLSearchParams(search)]
    .filter(([name]) => !omitted.includes(name))
    .map(([name, value]) => {
      const pair = JSON.stringify([name, value])
      const occurrence = occurrences.get(pair) ?? 0
      occurrences.set(pair, occurrence + 1)
      return { name, value, key: `${pair}:${occurrence}` }
    })
}
