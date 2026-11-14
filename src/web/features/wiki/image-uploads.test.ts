// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { imageUploads, insertUploadedImages } from './image-uploads'

const views: EditorView[] = []
function editor(doc = 'before after') {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [imageUploads] }) })
  views.push(view)
  return view
}
function deferred() {
  let resolve!: (url: string | null) => void
  const promise = new Promise<string | null>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

describe('deferred image uploads', () => {
  it('maps the insertion point through concurrent edits and deletion', async () => {
    const view = editor()
    const upload = deferred()
    const pending = insertUploadedImages(view, [new File(['x'], 'image.png')], 7, () => upload.promise)
    view.dispatch({ changes: { from: 0, to: 7, insert: 'new ' } })
    upload.resolve('/image')
    await pending
    expect(view.state.doc.toString()).toBe('new ![image.png](/image)\nafter')
  })

  it('does not dispatch into a destroyed editor or start another upload', async () => {
    const view = editor()
    const upload = deferred()
    let calls = 0
    const pending = insertUploadedImages(view, [new File(['x'], 'a.png'), new File(['x'], 'b.png')], 7, () => {
      calls++
      return upload.promise
    })
    view.destroy()
    upload.resolve('/image')
    await expect(pending).resolves.toBeUndefined()
    expect(calls).toBe(1)
    expect(view.state.doc.toString()).toBe('before after')
    views.splice(views.indexOf(view), 1)
  })

  it('cancels pending insertions when the editor switches documents', async () => {
    const view = editor()
    const upload = deferred()
    const pending = insertUploadedImages(view, [new File(['x'], 'a.png')], 7, () => upload.promise)
    view.plugin(imageUploads)?.cancel()
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'another page' } })
    upload.resolve('/image')
    await pending
    expect(view.state.doc.toString()).toBe('another page')
  })

  it('handles failed uploads and inserts subsequent images in order', async () => {
    const view = editor('')
    let calls = 0
    await insertUploadedImages(
      view,
      [new File(['x'], 'bad.png'), new File(['x'], '[a].png'), new File(['x'], 'b.png')],
      0,
      async () => {
        if (++calls === 1) throw new Error('offline')
        return '/image'
      },
    )
    expect(view.state.doc.toString()).toBe('![\\[a\\].png](/image)\n![b.png](/image)\n')
  })
})
