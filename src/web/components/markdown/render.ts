import { renderHtmlFromDocument } from '@comark/html'
import footnotes from '@comark/html/plugins/footnotes'
import math, { Math as MathComponent } from '@comark/html/plugins/math'
import mermaid, { Mermaid } from '@comark/html/plugins/mermaid'
import shiki from '@comark/html/plugins/shiki'
import toc, { type TocLink } from '@comark/html/plugins/toc'
import { createMarkdownParser, type ComarkPlugin } from 'comark'
import sanitizeHtml from 'sanitize-html'

export interface MarkdownHeading {
  readonly id: string
  readonly level: number
  readonly text: string
}
export interface RenderedMarkdown {
  readonly html: string
  readonly toc: ReadonlyArray<MarkdownHeading>
}
export interface MarkdownOptions {
  readonly pages?: ReadonlyArray<{ title: string; slug: string }>
  readonly workspaceSlug?: string
  readonly projectId?: string
}

/** Final allowlist applies equally to authored HTML and plugin-generated HTML/SVG. */
export function sanitizeMarkdownHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'details',
      'summary',
      'input',
      'svg',
      'g',
      'defs',
      'marker',
      'path',
      'rect',
      'line',
      'polyline',
      'polygon',
      'circle',
      'ellipse',
      'text',
      'tspan',
      'title',
    ],
    allowedAttributes: {
      '*': ['class', 'id', 'title', 'aria-label', 'aria-hidden', 'role', 'style'],
      a: ['href', 'rel', 'data-footnote-ref', 'data-footnote-backref'],
      img: ['src', 'alt', 'width', 'height'],
      input: ['type', 'checked', 'disabled'],
      th: ['align'],
      td: ['align'],
      svg: ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke'],
      g: ['transform', 'fill', 'stroke', 'stroke-width'],
      marker: ['viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'orient', 'markerUnits'],
      path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'marker-end', 'marker-start'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width'],
      line: ['x1', 'x2', 'y1', 'y2', 'stroke', 'stroke-width', 'marker-end'],
      polyline: ['points', 'fill', 'stroke', 'stroke-width', 'marker-end'],
      polygon: ['points', 'fill', 'stroke', 'stroke-width'],
      circle: ['cx', 'cy', 'r', 'fill', 'stroke'],
      ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke'],
      text: [
        'x',
        'y',
        'dx',
        'dy',
        'fill',
        'font-size',
        'font-family',
        'font-weight',
        'text-anchor',
        'dominant-baseline',
      ],
      tspan: ['x', 'y', 'dx', 'dy'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
    allowedStyles: {
      '*': {
        color: [/^#[\da-f]{3,8}$/i],
        'background-color': [/^#[\da-f]{3,8}$/i],
        '--shiki-light': [/^#[\da-f]{3,8}$/i],
        '--shiki-dark': [/^#[\da-f]{3,8}$/i],
        ...Object.fromEntries(
          ['--bg', '--fg', '--line', '--accent', '--muted', '--surface', '--border'].map((property) => [
            property,
            [/^#[\da-f]{3,8}$/i],
          ]),
        ),
        'font-style': [/^(normal|italic)$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'text-decoration': [/^(none|underline|line-through)$/],
        ...Object.fromEntries(
          [
            'height',
            'width',
            'min-width',
            'top',
            'left',
            'margin-left',
            'margin-right',
            'margin-top',
            'padding-left',
            'vertical-align',
            'border-bottom-width',
          ].map((property) => [property, [/^-?\d*(?:\.\d+)?(?:em|ex|px|%)$/]]),
        ),
      },
    },
    transformTags: {
      '*': (tagName, attribs) => {
        for (const key of ['fill', 'stroke']) {
          const paint = attribs[key]
          if (paint && !/^(?:[a-z]+|#[\da-f]{3,8}|var\(--[\w-]+\)|url\(#[\w-]+\))$/i.test(paint)) delete attribs[key]
        }
        for (const key of ['marker-end', 'marker-start']) {
          if (attribs[key] && !/^(?:none|url\(#[\w-]+\))$/.test(attribs[key])) delete attribs[key]
        }
        if (tagName === 'input') {
          attribs.type = 'checkbox'
          attribs.disabled = ''
        }
        return { tagName, attribs }
      },
    },
  })
}

function wikiLinks(options: MarkdownOptions): ComarkPlugin {
  const fold = (title: string) => title.normalize('NFC').toLowerCase()
  const pages = new Map(options.pages?.map((page) => [fold(page.title), page.slug]))
  const scoped = (path: string) => {
    const url = new URL(path, 'https://wiki.invalid')
    if (options.workspaceSlug) url.searchParams.set('workspace', options.workspaceSlug)
    if (options.projectId) url.searchParams.set('projectId', options.projectId)
    else if (options.workspaceSlug) url.searchParams.set('scope', 'workspace')
    return `${url.pathname}${url.search}${url.hash}`
  }
  return {
    name: 'projektor-wiki-links',
    markdownItPlugins: [
      (md) => {
        md.inline.ruler.before('link', 'projektor_wiki_link', (state, silent) => {
          if (
            !options.pages ||
            state.tokens.reduce(
              (depth, token) => depth + (token.type === 'link_open' ? 1 : token.type === 'link_close' ? -1 : 0),
              0,
            ) > 0 ||
            state.src.slice(state.pos, state.pos + 2) !== '[['
          )
            return false
          const match = /^\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/.exec(state.src.slice(state.pos, state.posMax))
          if (!match) return false
          if (!silent) {
            const title = match[1].trim()
            const label = match[2]?.trim() ?? title
            const slug = pages.get(fold(title))
            if (!slug) {
              state.push('mdc_inline_span', 'span', 1)
              state.push('text', '', 0).content = `${label} `
            }
            state
              .push('link_open', 'a', 1)
              .attrSet(
                'href',
                scoped(slug ? `/wiki/${encodeURIComponent(slug)}` : `/wiki?createTitle=${encodeURIComponent(title)}`),
              )
            state.push('text', '', 0).content = slug ? label : '+'
            state.push('link_close', 'a', -1)
            if (!slug) {
              state.push('mdc_inline_span', 'span', -1)
              state.push('mdc_inline_props', '', 0).attrSet('class', 'wiki-link-broken')
            }
          }
          state.pos += match[0].length
          return true
        })
      },
    ],
  }
}

/** Runtime rendering, not an Effront build-time Markdown resource. Parser defaults stay enabled. */
export async function renderMarkdownDocument(
  markdown: string,
  options: MarkdownOptions = {},
): Promise<RenderedMarkdown> {
  const plugins = [footnotes(), math(), mermaid(), shiki(), wikiLinks(options), toc()] as const
  // Per invocation parser keeps tenant text out of a shared incremental parser cache.
  const document = await createMarkdownParser({ plugins })(markdown)
  const html = sanitizeMarkdownHtml(
    await renderHtmlFromDocument(document, {
      components: { Math: MathComponent, Mermaid },
    }),
  )
  const flatten = (links: TocLink[]): MarkdownHeading[] =>
    links.flatMap((link) => [{ id: link.id, level: link.depth, text: link.text }, ...flatten(link.children ?? [])])
  return { html, toc: flatten(document.meta.toc.links) }
}
