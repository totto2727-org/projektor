// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vite-plus/test'

vi.mock('../../components/markdown/markdown-preview.tsx', () => ({
  useMarkdownPreview: () => ({ html: '' }),
}))

import MarkdownEditor from './markdown-editor.tsx'

afterEach(cleanup)

test('retains the editor and selection while using the latest committed change and image callbacks', async () => {
  const originalChange = vi.fn()
  const currentChange = vi.fn()
  const originalUpload = vi.fn(async () => '/old.png')
  const upload = Promise.withResolvers<string | null>()
  const currentUpload = vi.fn(() => upload.promise)
  const { rerender } = render(<MarkdownEditor value='Draft' onChange={originalChange} onImageFile={originalUpload} />)
  const textbox = screen.getByRole('textbox', { name: 'Markdown editor' })
  const view = EditorView.findFromDOM(textbox)
  if (!view) {
    throw new Error('Expected the real CodeMirror view')
  }
  act(() => view.dispatch({ selection: { anchor: 5 } }))

  rerender(<MarkdownEditor value='Draft' onChange={currentChange} onImageFile={currentUpload} />)
  expect(screen.getByRole('textbox', { name: 'Markdown editor' })).toBe(textbox)
  expect(EditorView.findFromDOM(textbox)).toBe(view)
  expect(view.state.selection.main.from).toBe(5)

  act(() => view.dispatch({ changes: { from: 5, insert: ' newest' } }))
  expect(currentChange).toHaveBeenLastCalledWith('Draft newest')
  expect(originalChange).not.toHaveBeenCalled()

  const file = new File(['image'], 'latest.png', { type: 'image/png' })
  fireEvent.paste(textbox, {
    clipboardData: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] },
  })
  expect(currentUpload).toHaveBeenCalledWith(file)
  expect(originalUpload).not.toHaveBeenCalled()
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' while uploading' } }))
  await act(async () => upload.resolve('/latest.png'))
  await waitFor(() => {
    expect(view.state.doc.toString()).toContain('![latest.png](/latest.png)')
    expect(view.state.doc.toString()).toContain('while uploading')
  })
  expect(currentChange).toHaveBeenLastCalledWith(view.state.doc.toString())
})
