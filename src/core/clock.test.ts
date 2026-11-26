import { describe, expect, test, vi } from 'vite-plus/test'

import { currentEpochMilliseconds, currentEpochSeconds } from '#contracts/time.ts'

const BEFORE_EPOCH_MILLISECONDS = -1
const BEFORE_EPOCH_SECONDS = -1
const AFTER_FIRST_SECOND_MILLISECONDS = 1001
const AFTER_FIRST_SECOND_SECONDS = 1

describe('synchronous wall clock', () => {
  test.each([
    {
      label: 'before the epoch',
      milliseconds: BEFORE_EPOCH_MILLISECONDS,
      seconds: BEFORE_EPOCH_SECONDS,
    },
    {
      label: 'past the first second',
      milliseconds: AFTER_FIRST_SECOND_MILLISECONDS,
      seconds: AFTER_FIRST_SECOND_SECONDS,
    },
  ])('reads milliseconds and rounds epoch seconds down $label', ({ milliseconds, seconds }): void => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(milliseconds)
    try {
      expect(currentEpochMilliseconds()).toBe(milliseconds)
      expect(currentEpochSeconds()).toBe(seconds)
    } finally {
      clock.mockRestore()
    }
  })
})
