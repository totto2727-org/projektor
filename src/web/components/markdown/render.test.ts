import { Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { runTestEffect } from '#tests/run-effect.ts'

import { renderMarkdownEffect } from './effect.ts'
import { renderMarkdownDocument, sanitizeMarkdownHtml } from './render.ts'

describe('untrusted runtime Comark', () => {
  test('renders mdts standard footnotes, math, Mermaid SVG and Shiki on the server', async () => {
    const { html } = await renderMarkdownDocument(
      '## Standard\n\nText[^note] and $x^2$.\n\n[^note]: A footnote\n\n```ts\nconst answer = 42\n```\n\n```mermaid\ngraph TD\n A --> B\n```',
    )
    expect(html).toContain('id="standard"')
    expect(html).toContain('footnote')
    expect(html).toContain('katex')
    expect(html).toContain('shiki')
    expect(html).toContain('github-light')
    expect(html).toContain('--shiki-dark:')
    expect(html).toContain('<svg')
    expect(html).toContain('viewBox')
    expect(html).toContain('--bg:#FFFFFF')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('fonts.googleapis.com')
  })

  test('takes heading ids and ToC from the same compiled document', async () => {
    const rendered = await renderMarkdownDocument('## **Overview**\n\n## Overview\n\n### 日本語\n\n## Last')
    expect(rendered.toc.map(({ text }) => text)).toEqual(['Overview', 'Overview', '日本語', 'Last'])
    Iterable.forEach(rendered.toc, (heading) => {
      expect(rendered.html).toContain(`id="${heading.id}"`)
    })
    expect(new Set(rendered.toc.map(({ id }) => id)).size).toBe(4)
  })

  test('resolves Wiki text nodes without interpreting labels as Markdown or touching code', async () => {
    const { html } = await renderMarkdownDocument(
      '[[Café|safe *label*]] [[Missing]]\n\n`[[Café]]`\n\n```text\n[[Café]]\n```',
      {
        pages: [{ title: 'Cafe\u0301', slug: 'café' }],
        workspaceSlug: 'team',
        projectId: 'project',
      },
    )
    expect(html).toContain('/wiki/caf%C3%A9?workspace=team&amp;projectId=project')
    expect(html).toContain('safe *label*')
    expect(html).toContain('wiki-link-broken')
    expect(html).toContain('createTitle=Missing&amp;workspace=team&amp;projectId=project')
    expect(html).toContain('<code>[[Café]]</code>')
    expect(html.match(/href="\/wiki\/caf/gu)).toHaveLength(1)
  })

  test('strips script, SVG event handlers, foreignObject, unsafe schemes and CSS', async () => {
    const { html } = await renderMarkdownDocument(
      '<script>evil()</script><img src="/image" onerror="evil()"><a href="javascript:evil()">bad</a>\n\n<svg onload="evil()"><foreignObject><iframe src="https://evil.invalid"></iframe></foreignObject><path fill="url(https://evil.invalid)" /></svg>\n\n<span style="color:#123456;background-image:url(https://evil.invalid)">safe</span>',
    )
    expect(html).not.toMatch(/<script|onerror|onload|javascript:|foreignObject|iframe|background-image|url\(https/u)
    expect(html).not.toContain('evil()')
  })

  test('sanitizes malformed Mermaid plugin fallback as well as authored HTML', async () => {
    const { html } = await renderMarkdownDocument('```mermaid\n<script>alert(1)</script>\n```')
    expect(html).not.toContain('<script')
    expect(sanitizeMarkdownHtml('<svg><path fill="URL(https://evil.invalid)" /></svg>')).not.toContain('evil.invalid')
  })

  test('provides a lazy domain Effect adapter', async () => {
    const rendered = await runTestEffect(renderMarkdownEffect('**Effect**'))
    expect(rendered.html).toContain('<strong>Effect</strong>')
  })
})
