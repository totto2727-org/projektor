import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

interface UploadAnchor {
  position: number
  active: boolean
}

class ImageUploads {
  readonly anchors = new Set<UploadAnchor>()

  update(update: ViewUpdate) {
    if (!update.docChanged) return
    for (const anchor of this.anchors) anchor.position = update.changes.mapPos(anchor.position, 1)
  }

  cancel() {
    for (const anchor of this.anchors) anchor.active = false
    this.anchors.clear()
  }

  destroy() {
    this.cancel()
  }
}

export const imageUploads = ViewPlugin.fromClass(ImageUploads)

export async function insertUploadedImages(
  view: EditorView,
  files: readonly File[],
  position: number,
  upload: (file: File) => Promise<string | null>,
): Promise<void> {
  const uploads = view.plugin(imageUploads)
  if (!uploads) return
  const anchor: UploadAnchor = { position, active: true }
  uploads.anchors.add(anchor)
  try {
    for (const file of files) {
      if (!anchor.active) return
      let url: string | null
      try {
        url = await upload(file)
      } catch {
        continue
      }
      if (!anchor.active) return
      if (!url) continue
      const label = file.name.replace(/[\\[\]]/g, '\\$&')
      view.dispatch({ changes: { from: anchor.position, insert: `![${label}](${url})\n` } })
    }
  } finally {
    uploads.anchors.delete(anchor)
  }
}
