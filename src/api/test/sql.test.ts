import { Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { inChunks, sanitizeFtsQuery } from '#commands/sql.ts'

describe('sanitizeFtsQuery (PROJ-518)', () => {
  test('wraps each whitespace-separated token in double quotes', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('"hello" "world"')
  })

  test('neutralizes FTS5 query syntax by treating it as literal text', () => {
    expect(sanitizeFtsQuery('foo AND bar OR NOT baz*')).toBe('"foo" "AND" "bar" "OR" "NOT" "baz*"')
  })

  test("escapes embedded double quotes so they can't break out of the phrase", () => {
    expect(sanitizeFtsQuery('say "hi"')).toBe('"say" """hi"""')
  })

  test('drops tokens with no word characters', () => {
    expect(sanitizeFtsQuery('--- ??? hello')).toBe('"hello"')
  })

  test('returns an empty string for blank input', () => {
    expect(sanitizeFtsQuery('   ')).toBe('')
  })
})

describe('inChunks', () => {
  test('returns an empty array without calling op for an empty input', async () => {
    let called = false
    const result = await inChunks([], async () => {
      called = true
      return []
    })
    expect(result).toStrictEqual([])
    expect(called).toBe(false)
  })

  test('makes a single call when the input is well under the D1 bound-parameter cap', async () => {
    const items = Array.from({ length: 10 }, (_value, index) => index)
    const chunks: number[][] = []
    const result = await inChunks(items, async (chunk) => {
      chunks.push(chunk)
      return chunk.map((n) => n * 2)
    })
    expect(chunks).toHaveLength(1)
    expect(result).toStrictEqual(items.map((item) => item * 2))
  })

  test("splits a 250-item array into 3 chunks, each at or under D1's 100 bound-parameter cap", async () => {
    const items = Array.from({ length: 250 }, (_value, index) => index)
    const chunkSizes: number[] = []
    const result = await inChunks(items, async (chunk) => {
      chunkSizes.push(chunk.length)
      return chunk
    })

    expect(chunkSizes).toHaveLength(3)
    Iterable.forEach(chunkSizes, (size) => {
      expect(size).toBeLessThanOrEqual(100)
    })
    expect(chunkSizes.reduce((a, b) => a + b, 0)).toBe(250)
    // Concatenation preserves order and every item exactly once
    expect(result).toStrictEqual(items)
  })

  test('chunks exactly at a 100-item boundary into more than one call', async () => {
    const items = Array.from({ length: 100 }, (_value, index) => index)
    const chunkSizes: number[] = []
    await inChunks(items, async (chunk) => {
      chunkSizes.push(chunk.length)
      return []
    })
    expect(chunkSizes.length).toBeGreaterThan(1)
    Iterable.forEach(chunkSizes, (size) => {
      expect(size).toBeLessThanOrEqual(100)
    })
  })

  test('supports mutation-style callbacks that return no rows', async () => {
    const items = Array.from({ length: 150 }, (_value, index) => index)
    const seen: number[] = []
    const result = await inChunks(items, async (chunk) => {
      seen.push(...chunk)
      return []
    })
    expect(result).toStrictEqual([])
    expect(seen).toStrictEqual(items)
  })
})
