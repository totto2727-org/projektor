import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vite-plus/test'

import { renderMarkdownDocument } from '@/components/markdown/render.ts'

import { decorateHeadings } from './headings.ts'
import { renderMd, renderMdWithWikilinks } from './render-markdown.ts'
import { WikiPageClient } from './wiki-page-client.tsx'
import type { WikiSeed } from './wiki-page-client.tsx'

vi.mock('./actions', () => ({}))
vi.mock('../../attachment-actions', () => ({
  uploadAttachment: () => {},
  uploadInlineImage: () => {},
}))
vi.mock('@effront/core/query', () => ({
  query: () => {
    throw new Error('No client bootstrap during SSR')
  },
}))

function wikiSeed(): WikiSeed {
  return {
    workspaceSlug: 'team',
    projectId: '',
    slug: 'guide',
    mode: 'read',
    brandName: 'Acme',
    publicViewer: false,
    createTitle: '',
    filterType: '',
    filterStatus: '',
    filterTags: '',
    searchQuery: '',
    draft: null,
    draftStatus: 'ready',
    tree: [{ id: 'page', slug: 'guide', title: 'Guide', type: 'reference', children: [] }],
    revisions: [
      {
        id: 'rev',
        author_id: 'user',
        author_name: 'Alice',
        created_at: 1_700_000_000,
        summary: 'First revision',
      },
    ],
    attachments: [
      {
        id: 'file',
        filename: 'guide.pdf',
        contentType: 'application/pdf',
        size: 42,
        createdAt: 1_700_000_000,
      },
    ],
    templates: [{ id: 'template', slug: 'template', title: 'How-to' }],
    projects: [],
    stalePages: [],
    filteredPages: [],
    searchResults: [],
    page: {
      id: 'page',
      slug: 'guide',
      title: 'Guide',
      content:
        '## Overview\n\nUseful **server rendered** text.\n\n[[Guide]]\n\n<script>evil()</script>\n\n```mermaid\ngraph TD; A-->B\n```',
      project_id: null,
      parent_id: null,
      revisionId: 'rev',
      updated_at: 1_700_000_000,
      type: 'reference',
      status: 'verified',
      tags: ['docs'],
      owners: ['Alice'],
      verified_at: 1_700_000_000,
      verified_by: 'Alice',
      verify_interval: 30,
      freshness: { state: 'fresh', staleSince: null },
    },
  }
}
describe('original Wiki React SSR', () => {
  test('renders original body, sidebar, controls and attachments without a browser effect', async () => {
    const seed = wikiSeed()
    seed.renderedMarkdown = await renderMarkdownDocument(seed.page?.content ?? '', {
      pages: [{ title: 'Guide', slug: 'guide' }],
      workspaceSlug: 'team',
      projectId: '',
    })
    const html = renderToStaticMarkup(<WikiPageClient initial={seed} />)
    expect(html).toContain('Useful <strong>server rendered</strong> text.')
    expect(html).toContain('id="overview"')
    expect(html).toContain('guide.pdf')
    expect(html).toContain('Duplicate')
    expect(html).toContain('Move')
    expect(html).toContain('Edit')
    expect(html).toContain('Guide - Acme Wiki')
    expect(html).toContain('workspace=team')
    expect(html).not.toContain('evil()')
  })

  test('renders create and edit control trees from server route state', () => {
    const seed = wikiSeed()
    expect(
      renderToStaticMarkup(<WikiPageClient initial={{ ...seed, mode: 'create', createTitle: 'New Guide' }} />),
    ).toContain('New Guide')
    expect(renderToStaticMarkup(<WikiPageClient initial={{ ...seed, mode: 'edit' }} />)).toContain('id="wiki-title"')
  })

  test('sanitizes markdown on the server and renders Mermaid and tables', async () => {
    const html = await renderMd(
      '## Server\n\n<img src="/image" onerror="evil()"><a href="javascript:evil()">bad</a><script>evil()</script>\n\n|A|B|\n|-|-|\n|1|2|\n\n```mermaid\ngraph TD; A-->B\n```',
    )
    expect(html).toContain('<h2 id="server">Server</h2>')
    expect(html).toContain('<table>')
    expect(html).toContain('class="mermaid"')
    expect(html).not.toMatch(/javascript:|onerror|<script|evil\(\)/u)
  })

  test('preserves named heading entities and does not double-encode authored IDs', () => {
    const { html, toc } = decorateHeadings('<h2 id="custom&amp;id">Copyright &copy; &amp; notes</h2>')
    expect(toc[0]).toMatchObject({ id: 'custom&id', text: 'Copyright © & notes' })
    expect(html).toContain('id="custom&amp;id"')
    expect(html).not.toContain('amp;amp')
  })

  test('deduplicates headings while retaining authored IDs and resolves Wiki links', async () => {
    const { html, toc } = decorateHeadings('<h2>Overview</h2><h2>Overview</h2><h2 id="overview-1">Custom</h2>')
    expect(new Set(toc.map((item) => item.id)).size).toBe(3)
    expect(html).toContain('id="overview-1"')
    await expect(
      renderMdWithWikilinks('[[Guide]] [[Missing]]', [{ title: 'Guide', slug: 'guide' }]),
    ).resolves.toContain('/wiki/guide')
  })
})
