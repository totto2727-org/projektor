// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import type { JSX } from 'react'
import { afterEach, expect, test, vi } from 'vite-plus/test'

import type { Props } from './markdown-editor.tsx'

const chunk = vi.hoisted(() => Promise.withResolvers<{ default: (props: Props) => React.ReactNode }>())
vi.mock('./markdown-editor.tsx', () => chunk.promise)

import LazyMarkdownEditor from './lazy-markdown-editor.tsx'

afterEach(cleanup)

test('commits fallback input before blur and preserves it when the editor chunk resolves', async () => {
  const changed = vi.fn()
  function Editor(): JSX.Element {
    const [value, setValue] = useState('')
    return (
      <LazyMarkdownEditor
        value={value}
        minHeight='120px'
        onChange={(next) => {
          changed(next)
          setValue(next)
        }}
      />
    )
  }
  render(<Editor />)
  const fallback = screen.getByRole('textbox', { name: 'Markdown editor' })
  fireEvent.focus(fallback)
  fireEvent.input(fallback, { target: { value: 'Early native draft' } })
  expect(changed).toHaveBeenLastCalledWith('Early native draft')
  await act(async () =>
    chunk.resolve({ default: ({ value }) => <textarea aria-label='Loaded editor' value={value} readOnly /> }),
  )
  expect(screen.queryByRole('textbox', { name: 'Loaded editor' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Markdown editor' })).toBe(fallback)
  fireEvent.blur(fallback)
  expect(screen.queryByRole('textbox', { name: 'Loaded editor' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Markdown editor' })).toBe(fallback)
  expect(fallback).toHaveProperty('value', 'Early native draft')
})
