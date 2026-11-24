import { describe, expect, test } from 'vite-plus/test'

import { parseWikiLinkTargets } from '#commands/wiki-links.ts'

describe('parseWikiLinkTargets (PROJ-483)', () => {
  test('returns no targets for content with no links', () => {
    expect(parseWikiLinkTargets('just some body text')).toStrictEqual([])
  })

  test('parses a bare wikilink as a title target', () => {
    expect(parseWikiLinkTargets('see [[Onboarding Guide]] for details')).toEqual([
      { kind: 'title', title: 'Onboarding Guide' },
    ])
  })

  test('parses a piped wikilink using only the title, ignoring the display label', () => {
    expect(parseWikiLinkTargets('see [[Onboarding Guide|start here]]')).toEqual([
      { kind: 'title', title: 'Onboarding Guide' },
    ])
  })

  test('parses a same-workspace path-rooted markdown link as a slug target', () => {
    expect(parseWikiLinkTargets('[docs](/wiki/onboarding-guide)')).toEqual([{ kind: 'slug', slug: 'onboarding-guide' }])
  })

  test('parses a same-workspace query-string markdown link as a slug target', () => {
    expect(parseWikiLinkTargets('[docs](/wiki?slug=onboarding-guide)')).toEqual([
      { kind: 'slug', slug: 'onboarding-guide' },
    ])
  })

  test('ignores an absolute-URL markdown link', () => {
    expect(parseWikiLinkTargets('[external](https://example.com/wiki/foo)')).toStrictEqual([])
  })

  test('ignores a protocol-relative markdown link', () => {
    expect(parseWikiLinkTargets('[external](//example.com/wiki/foo)')).toStrictEqual([])
  })

  test('ignores a markdown link with no recognizable wiki path or slug param', () => {
    expect(parseWikiLinkTargets('[label](/issues/view?id=123)')).toStrictEqual([])
  })

  test('decodes a percent-escaped slug in the query-param form', () => {
    expect(parseWikiLinkTargets('[docs](/wiki?slug=caf%C3%A9-notes)')).toEqual([{ kind: 'slug', slug: 'café-notes' }])
  })

  test('ignores a markdown link with a malformed percent-escape instead of throwing', () => {
    expect(parseWikiLinkTargets('[docs](/wiki?slug=bad%escape)')).toStrictEqual([])
  })

  test('collects multiple targets across a mix of wikilinks and markdown links', () => {
    const content = '[[Page A]] and [[Page B|alt]] plus [link](/wiki/page-c)'
    expect(parseWikiLinkTargets(content)).toEqual([
      { kind: 'title', title: 'Page A' },
      { kind: 'title', title: 'Page B' },
      { kind: 'slug', slug: 'page-c' },
    ])
  })
})
