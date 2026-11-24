import { renderMarkdownDocument } from '@/components/markdown/render.ts'
import type { MarkdownOptions } from '@/components/markdown/render.ts'

/** Untrusted dynamic Markdown uses the same async Comark pipeline on server and client. */
export const renderMd = async function renderMd(markdown: string): Promise<string> {
  return (await renderMarkdownDocument(markdown)).html
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/
export const stripFrontmatter = function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, '')
}

export const renderMdWithWikilinks = async function renderMdWithWikilinks(
  markdown: string,
  pages: NonNullable<MarkdownOptions['pages']>,
): Promise<string> {
  return (await renderMarkdownDocument(markdown, { pages })).html
}
