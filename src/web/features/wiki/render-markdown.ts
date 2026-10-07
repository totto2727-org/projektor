import { renderMarkdownDocument, type MarkdownOptions } from '../../components/markdown/render'

/** Untrusted dynamic Markdown uses the same async Comark pipeline on server and client. */
export async function renderMd(markdown: string): Promise<string> {
  return (await renderMarkdownDocument(markdown)).html
}
export const renderMarkdown = renderMd

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, '')
}

export async function renderMdWithWikilinks(
  markdown: string,
  pages: NonNullable<MarkdownOptions['pages']>,
): Promise<string> {
  return (await renderMarkdownDocument(markdown, { pages })).html
}
