// @vitest-environment jsdom
import './test/browser'
import { act, renderHook } from '@testing-library/react'
import { Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { PointsText, TitleText, useIssueForm } from './forms'

describe('TanStack issue forms with Effect Standard Schema validators', () => {
  it('validates through TanStack without field useState and preserves dirty values across canonical defaults', async () => {
    const hook = renderHook(({ title }) => useIssueForm({ title }, Schema.Struct({ title: TitleText })), {
      initialProps: { title: 'Initial title' },
    })
    const setter = hook.result.current.field('title')[1]
    act(() => setter('   '))
    let valid = true
    await act(async () => {
      valid = await hook.result.current.validate()
    })
    expect(valid).toBe(false)
    act(() => setter('Unsaved title'))
    hook.rerender({ title: 'Canonical title' })
    expect(hook.result.current.field('title')[0]).toBe('Unsaved title')
    expect(hook.result.current.field('title')[1]).toBe(setter)
    await act(async () => {
      valid = await hook.result.current.validate()
    })
    expect(valid).toBe(true)
  })
  it('keeps original signed, decimal, exponent and empty story point editing', async () => {
    const hook = renderHook(() => useIssueForm({ points: '' }, Schema.Struct({ points: PointsText })))
    for (const points of ['', '-1', '.5', '1e2']) {
      act(() => hook.result.current.field('points')[1](points))
      let valid = false
      await act(async () => {
        valid = await hook.result.current.validate()
      })
      expect(valid).toBe(true)
    }
    act(() => hook.result.current.field('points')[1]('not-a-number'))
    let valid = true
    await act(async () => {
      valid = await hook.result.current.validate()
    })
    expect(valid).toBe(false)
  })
})
