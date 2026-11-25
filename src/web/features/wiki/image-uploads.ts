import { EditorView, ViewPlugin } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { String, Predicate, Iterable } from 'effect'

interface UploadAnchor {
  position: number
  active: boolean
}

class ImageUploads {
  public readonly anchors = new Set<UploadAnchor>()

  public update(update: ViewUpdate): void {
    if (!update.docChanged) {
      return
    }
    Iterable.forEach(this.anchors, (anchor) => {
      anchor.position = update.changes.mapPos(anchor.position, 1)
    })
  }

  public cancel(): void {
    Iterable.forEach(this.anchors, (anchor) => {
      anchor.active = false
    })
    this.anchors.clear()
  }

  public destroy(): void {
    this.cancel()
  }
}

export const imageUploads = ViewPlugin.fromClass(ImageUploads)

export const insertUploadedImages = async function insertUploadedImages(
  view: EditorView,
  files: Readonly<File[]>,
  position: number,
  upload: (file: File) => Promise<string | null>,
): Promise<void> {
  const uploads = view.plugin(imageUploads)
  if (!uploads) {
    return
  }
  const anchor: UploadAnchor = { position, active: true }
  uploads.anchors.add(anchor)
  try {
    for (const file of files) {
      if (!anchor.active) {
        return
      }
      let url: string | null
      try {
        url = await upload(file)
      } catch {
        continue
      }
      if (!anchor.active) {
        return
      }
      if (Predicate.isNullish(url) || String.isEmpty(url)) {
        continue
      }
      const label = file.name.replaceAll(/[\\[\]]/gu, '\\$&')
      view.dispatch({ changes: { from: anchor.position, insert: `![${label}](${url})\n` } })
    }
  } finally {
    uploads.anchors.delete(anchor)
  }
}
