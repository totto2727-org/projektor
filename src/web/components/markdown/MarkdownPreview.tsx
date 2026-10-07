'use client'

import { useEffect, useState } from 'react'

import { renderMarkdownDocument, type MarkdownOptions, type RenderedMarkdown } from './render'

import 'katex/dist/katex.min.css'
import './markdown.css'

const empty: RenderedMarkdown = { html: '', toc: [] }

/** Local rendering only, no API dispatcher. Debounce and ignore superseded async work. */
export function useMarkdownPreview(
  content: string,
  options: MarkdownOptions = {},
  initial?: RenderedMarkdown,
  delay = 200,
): RenderedMarkdown {
  const key = JSON.stringify(options)
  const [result, setResult] = useState(() => ({ content, key, document: empty }))
  useEffect(() => {
    if (initial || (result.content === content && result.key === key && result.document !== empty)) return
    let active = true
    const timer = setTimeout(() => {
      void renderMarkdownDocument(content, JSON.parse(key) as MarkdownOptions).then(
        (document) => {
          if (active) setResult({ content, key, document })
        },
        () => {
          if (active)
            setResult({
              content,
              key,
              document: { html: '<p>Unable to render Markdown.</p>', toc: [] },
            })
        },
      )
    }, delay)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [content, key, delay, result, initial])
  // Canonical SSR/action props win immediately, without a replacement client store.
  if (initial) return initial
  // Do not display a previous entity's body while a new render is pending.
  return result.content === content && result.key === key ? result.document : empty
}

export function MarkdownPreview({
  content,
  initial,
  className = '',
  options,
}: {
  readonly content: string
  readonly initial?: RenderedMarkdown
  readonly className?: string
  readonly options?: MarkdownOptions
}) {
  const { html } = useMarkdownPreview(content, options, initial)
  return (
    <div
      className={`markdown-content prose prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
