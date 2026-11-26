import { Data, Effect } from 'effect'

import { renderMarkdownDocument } from './render.ts'
import type { MarkdownOptions } from './render.ts'

export class MarkdownRenderError extends Data.TaggedError('MarkdownRenderError')<
  Readonly<{ message: string; cause: unknown }>
> {}

/**
 * Domains choose their own error adaptation without changing HTTP decoding.
 *
 * @param {string} content The Markdown document to render.
 * @param {MarkdownOptions} options Optional rendering and Wiki link resolution settings.
 * @returns {ReturnType<typeof renderMarkdownEffect>} An effect that yields the rendered document or a MarkdownRenderError.
 */
export const renderMarkdownEffect = (content: string, options?: MarkdownOptions) =>
  Effect.tryPromise({
    catch: (cause) => new MarkdownRenderError({ message: 'Markdown could not be rendered.', cause }),
    try: () => renderMarkdownDocument(content, options),
  })
