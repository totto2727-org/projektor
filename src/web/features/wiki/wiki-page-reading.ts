'use client'

import { Array, Iterable, Option, Predicate, String } from 'effect'
import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { fieldsInOrder } from '#contracts/ordered-fields.ts'
import { useMarkdownPreview } from '@/components/markdown/markdown-preview.tsx'
import type { RenderedMarkdown } from '@/components/markdown/render.ts'

import { stripFrontmatter } from './render-markdown.ts'
import { useWikiSeed } from './wiki-seed-context.ts'

const HASH_CONTENT_START = 1
type MarkdownPage = Readonly<{ title: string; slug: string }>

/**
 * Use canonical server HTML and headings for persisted content.
 * Render local unsaved content asynchronously.
 *
 * @param {string | undefined} content The current Wiki Markdown, when a page is available.
 * @param {Readonly<MarkdownPage[]>} wikiPages The titles and slugs used to resolve Wiki links.
 * @returns {RenderedMarkdown} The canonical or locally rendered HTML and table of contents.
 */
export const useRenderedPageMarkdown = function useRenderedPageMarkdown(
  content: string | undefined,
  wikiPages: Readonly<MarkdownPage[]>,
): RenderedMarkdown {
  const seed = useWikiSeed()
  return useMarkdownPreview(
    stripFrontmatter(content ?? ''),
    fieldsInOrder([
      [
        'pages',
        wikiPages.map(({ title, slug }) =>
          fieldsInOrder([
            ['title', title],
            ['slug', slug],
          ]),
        ),
      ],
      ['workspaceSlug', seed.workspaceSlug],
      ['projectId', seed.projectId],
    ]),
    Predicate.isNullish(content) ? undefined : seed.renderedMarkdown,
  )
}

const safeDecodeURIComponent = function safeDecodeURIComponent(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}

const findInContent = function findInContent(container: HTMLElement, id: string): HTMLElement | undefined {
  // Limit matching to page content and compare IDs directly so CSS special characters work.
  const candidates = container.querySelectorAll<HTMLElement>('[id]')
  return Option.getOrUndefined(Iterable.findFirst(candidates, (el) => el.id === id))
}

const readHash = function readHash(location: Partial<Pick<Location, 'hash'>>): string {
  return (location.hash ?? '').slice(HASH_CONTENT_START)
}

const findHashHeading = function findHashHeading(container: HTMLElement | null, raw: string): HTMLElement | undefined {
  if (Predicate.isNullish(container)) {
    return undefined
  }
  return findInContent(container, safeDecodeURIComponent(raw) ?? raw)
}

const revealHashHeading = function revealHashHeading(heading: HTMLElement): void {
  heading.scrollIntoView()
  // The negative tab index enables programmatic focus without changing the Tab order.
  heading.setAttribute('tabindex', '-1')
  heading.focus({ preventScroll: true })
}

export type NavigationWindow = Partial<Pick<Window, 'navigation'>>

/**
 * Scroll once per page and hash when the target heading has rendered.
 * Native hash and history changes allow a new scroll even when the hash stays the same.
 *
 * @param {RenderedMarkdown['toc']} toc The rendered table of contents.
 * @param {RefObject<HTMLDivElement | null>} contentRef The rendered page container.
 * @param {string | undefined} pageSlug The canonical page slug.
 * @returns {void}
 */
export const useHashScroll = function useHashScroll(
  toc: RenderedMarkdown['toc'],
  contentRef: RefObject<HTMLDivElement | null>,
  pageSlug: string | undefined,
): void {
  const handledRef = useRef('')

  const scrollToHash = useCallback((): void => {
    const raw = readHash(globalThis.window.location)
    if (String.isEmpty(raw)) {
      return
    }
    const key = `${pageSlug ?? ''}#${raw}`
    const heading = handledRef.current === key ? undefined : findHashHeading(contentRef.current, raw)
    // A heading that renders later can still be found on the next TOC build.
    if (Predicate.isNotNullish(heading)) {
      handledRef.current = key
      revealHashHeading(heading)
    }
  }, [contentRef, pageSlug])

  useEffect(() => {
    if (Array.isReadonlyArrayNonEmpty(toc)) {
      scrollToHash()
    }
  }, [toc, scrollToHash])

  useEffect(() => {
    const onNavigate = function onNavigate(): void {
      handledRef.current = ''
      scrollToHash()
    }
    const browserWindow: NavigationWindow = globalThis.window
    globalThis.window.addEventListener('hashchange', onNavigate)
    browserWindow.navigation?.addEventListener('currententrychange', onNavigate)
    return () => {
      globalThis.window.removeEventListener('hashchange', onNavigate)
      browserWindow.navigation?.removeEventListener('currententrychange', onNavigate)
    }
  }, [scrollToHash])
}
