import { Data, Effect } from 'effect'

import { renderMarkdownDocument } from './render.ts'
import type { MarkdownOptions } from './render.ts'

export class MarkdownRenderError extends Data.TaggedError('MarkdownRenderError')<{
  readonly message: string
  readonly cause: unknown
}> {}

/** Domains choose their own error adaptation without changing HTTP decoding. */
export const renderMarkdownEffect = (content: string, options?: MarkdownOptions) =>
  Effect.tryPromise({
    try: () => renderMarkdownDocument(content, options),
    catch: (cause) => new MarkdownRenderError({ message: 'Markdown could not be rendered.', cause }),
  })
