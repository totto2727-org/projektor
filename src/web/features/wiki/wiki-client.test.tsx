// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { uploadInlineImage } from '../../attachment-actions'
import { discardWikiDraft, getWikiDraft, getWikiPage, saveWikiDraft, saveWikiPage } from './actions'
import { navigateFeature } from './navigation'
import { WikiPageClient, type WikiSeed } from './WikiPageClient'

vi.mock('../../attachment-actions', () => ({
  uploadAttachment: vi.fn(),
  uploadInlineImage: vi.fn(),
}))

vi.mock('./navigation', () => ({ navigateFeature: vi.fn() }))

vi.mock('./actions', () => ({
  createWikiPage: vi.fn(),
  deleteWikiAttachment: vi.fn(),
  discardWikiDraft: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, revision: 'discarded' } }),
  duplicateWikiPage: vi.fn(),
  getWikiDraftState: vi.fn().mockResolvedValue({ ok: true, value: { draft: null, revision: null } }),
  getWikiDraft: vi.fn().mockResolvedValue({ ok: true, value: null }),
  getWikiPage: vi.fn(),
  getWikiRevisionDiff: vi.fn(),
  moveWikiPage: vi.fn(),
  restoreTrashedWikiPage: vi.fn(),
  restoreWikiRevision: vi.fn(),
  saveWikiDraft: vi
    .fn()
    .mockResolvedValue({ ok: true, value: { ok: true, pageId: 'page', updatedAt: 1, revision: 'saved' } }),
  saveWikiPage: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, draftRevision: 'published' } }),
  trashWikiPage: vi.fn(),
  verifyWikiPage: vi.fn(),
}))
vi.mock('@effront/core/query', () => ({
  query: (operation: (input: unknown) => Promise<unknown>) => (input: unknown) =>
    Effect.promise(() => operation(input)),
}))
vi.mock('./LazyMarkdownEditor', () => ({
  default: ({
    value,
    onChange,
    onImageFile,
  }: {
    value: string
    onChange: (value: string) => void
    onImageFile?: (file: File) => Promise<string | null>
  }) => (
    <>
      <textarea aria-label='Markdown' value={value} onChange={(event) => onChange(event.target.value)} />
      <button
        type='button'
        onClick={async () => {
          const url = await onImageFile?.(new File(['image'], 'inline.png', { type: 'image/png' }))
          if (url) onChange(`${value}\n![inline](${url})`)
        }}
      >
        Paste inline image
      </button>
    </>
  ),
}))
function seed(): WikiSeed & { page: NonNullable<WikiSeed['page']> } {
  return {
    workspaceSlug: 'team',
    projectId: '',
    slug: 'guide',
    mode: 'edit',
    brandName: 'Acme',
    publicViewer: false,
    createTitle: '',
    filterType: '',
    filterStatus: '',
    filterTags: '',
    searchQuery: '',
    draft: null,
    draftStatus: 'ready',
    tree: [],
    revisions: [],
    attachments: [],
    templates: [],
    projects: [],
    stalePages: [],
    filteredPages: [],
    searchResults: [],
    page: {
      id: 'page',
      slug: 'guide',
      title: 'Guide',
      content: 'Published',
      project_id: null,
      parent_id: null,
      revisionId: 'rev',
      updated_at: 1,
      type: null,
      status: null,
      tags: [],
      owners: [],
      verified_at: null,
      verified_by: null,
      verify_interval: null,
      freshness: null,
    },
  }
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(saveWikiPage).mockResolvedValue({ ok: true, value: { ok: true, draftRevision: 'published' } })
  vi.mocked(saveWikiDraft).mockResolvedValue({
    ok: true,
    value: { ok: true, pageId: 'page', updatedAt: 1, revision: 'saved' },
  })
  vi.mocked(discardWikiDraft).mockResolvedValue({ ok: true, value: { ok: true, revision: 'discarded' } })
})
describe('Wiki delayed draft lifecycle', () => {
  async function debounce() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
  }
  function timers() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  }
  it('does not resurrect submitted A when unmounted during publication without newer typing', async () => {
    const publication = Promise.withResolvers<Awaited<ReturnType<typeof saveWikiPage>>>()
    vi.mocked(saveWikiPage).mockReturnValueOnce(publication.promise)
    const view = render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Submitted A' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    view.unmount()
    await act(async () => {
      publication.resolve({ ok: true, value: { ok: true, draftRevision: 'published-head' } })
    })
    expect(saveWikiDraft).not.toHaveBeenCalled()
  })
  it('does not resurrect the discarded snapshot when unmounted during deletion', async () => {
    const deletion = Promise.withResolvers<Awaited<ReturnType<typeof discardWikiDraft>>>()
    vi.mocked(discardWikiDraft).mockReturnValueOnce(deletion.promise)
    const view = render(
      <WikiPageClient
        initial={{ ...seed(), draft: { title: 'Saved', content: 'Recover me', baseRevisionId: 'rev', updatedAt: 2 } }}
      />,
    )
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Discarded A' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })
    view.unmount()
    await act(async () => {
      deletion.resolve({ ok: true, value: { ok: true, revision: 'discard-head' } })
    })
    expect(saveWikiDraft).not.toHaveBeenCalled()
  })
  it('serializes autosaves and coalesces B/C behind delayed A using acknowledged revisions', async () => {
    timers()
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof saveWikiDraft>>>()
    vi.mocked(saveWikiDraft).mockReturnValueOnce(pending.promise)
    render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'A' } })
    await debounce()
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'B' } })
    await debounce()
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'C' } })
    await debounce()
    expect(saveWikiDraft).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ ok: true, value: { ok: true, pageId: 'page', updatedAt: 1, revision: 'A-revision' } })
    })
    expect(saveWikiDraft).toHaveBeenCalledTimes(2)
    expect(saveWikiDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'C', expectedDraftRevision: 'A-revision' }),
    )
  })
  it('keeps failed autosaves unacknowledged without blindly retrying on leave', async () => {
    timers()
    vi.mocked(saveWikiDraft).mockResolvedValueOnce({ ok: false, status: 503, message: 'Unavailable' })
    const view = render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Keep A' } })
    await debounce()
    expect(screen.getByText(/Autosave did not complete/)).toBeTruthy()
    await act(async () => {
      view.unmount()
    })
    expect(saveWikiDraft).toHaveBeenCalledTimes(1)
    expect(saveWikiDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'Keep A', expectedDraftRevision: null }),
    )
  })
  it('waits for autosave before publication and keeps newer typing after delayed publication', async () => {
    timers()
    const draft = Promise.withResolvers<Awaited<ReturnType<typeof saveWikiDraft>>>()
    const publication = Promise.withResolvers<Awaited<ReturnType<typeof saveWikiPage>>>()
    vi.mocked(saveWikiDraft).mockReturnValueOnce(draft.promise)
    vi.mocked(saveWikiPage).mockReturnValueOnce(publication.promise)
    const initial = seed()
    vi.mocked(getWikiPage).mockResolvedValue({
      ok: true,
      value: {
        ...initial.page,
        project_id: initial.page.project_id ?? null,
        content: 'A',
        revisionId: 'published-page',
      },
    })
    render(<WikiPageClient initial={initial} />)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'A' } })
    await debounce()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(saveWikiPage).not.toHaveBeenCalled()
    await act(async () => {
      draft.resolve({ ok: true, value: { ok: true, pageId: 'page', updatedAt: 1, revision: 'A-head' } })
    })
    expect(saveWikiPage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'A', expectedDraftRevision: 'A-head' }),
    )
    expect(saveWikiPage).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Newer B' } })
    await act(async () => {
      publication.resolve({ ok: true, value: { ok: true, draftRevision: 'published-head' } })
    })
    expect((screen.getByLabelText('Markdown') as HTMLTextAreaElement).value).toBe('Newer B')
    await debounce()
    expect(saveWikiDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: 'Newer B',
        expectedDraftRevision: 'published-head',
        baseRevisionId: 'published-page',
      }),
    )
  })
  it('flushes newer typing on unmount after pending publication without resurrecting the submitted snapshot', async () => {
    const publication = Promise.withResolvers<Awaited<ReturnType<typeof saveWikiPage>>>()
    vi.mocked(saveWikiPage).mockReturnValueOnce(publication.promise)
    const view = render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Submitted A' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Leaving B' } })
    view.unmount()
    expect(saveWikiDraft).not.toHaveBeenCalled()
    await act(async () => {
      publication.resolve({ ok: true, value: { ok: true, draftRevision: 'published-head' } })
    })
    expect(saveWikiDraft).toHaveBeenCalledTimes(1)
    expect(saveWikiDraft).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Leaving B', expectedDraftRevision: 'published-head' }),
    )
  })
  it('keeps text and the restore choice when a delayed discard fails', async () => {
    const deletion = Promise.withResolvers<Awaited<ReturnType<typeof discardWikiDraft>>>()
    vi.mocked(discardWikiDraft).mockReturnValueOnce(deletion.promise)
    const initial = seed()
    render(
      <WikiPageClient
        initial={{ ...initial, draft: { title: 'Saved', content: 'Recover me', baseRevisionId: 'rev', updatedAt: 2 } }}
      />,
    )
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Local A' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Local B' } })
    await act(async () => {
      deletion.resolve({ ok: false, status: 503, message: 'Unavailable' })
    })
    expect((screen.getByLabelText('Markdown') as HTMLTextAreaElement).value).toBe('Local B')
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    expect(screen.getByText(/Save failed/)).toBeTruthy()
  })
  it('preserves newer local typing when discard succeeds, then autosaves it under the new head', async () => {
    timers()
    const deletion = Promise.withResolvers<Awaited<ReturnType<typeof discardWikiDraft>>>()
    vi.mocked(discardWikiDraft).mockReturnValueOnce(deletion.promise)
    render(
      <WikiPageClient
        initial={{ ...seed(), draft: { title: 'Saved', content: 'Recover me', baseRevisionId: 'rev', updatedAt: 2 } }}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })
    expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Newer B' } })
    await act(async () => {
      deletion.resolve({ ok: true, value: { ok: true, revision: 'discard-head' } })
    })
    expect((screen.getByLabelText('Markdown') as HTMLTextAreaElement).value).toBe('Newer B')
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull()
    await debounce()
    expect(saveWikiDraft).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Newer B', expectedDraftRevision: 'discard-head' }),
    )
  })
})
describe('Wiki server prop adoption', () => {
  it('keeps the mobile page-tree backdrop aligned below the header and below the drawer', () => {
    const { container } = render(<WikiPageClient initial={seed()} />)
    const stylesheet = container.querySelector('style')?.sheet
    const mobileRules = Array.from(stylesheet?.cssRules ?? []).find(
      (rule) =>
        rule instanceof CSSMediaRule &&
        rule.conditionText === '(max-width: 640px)' &&
        Array.from(rule.cssRules).some((child) => (child as CSSStyleRule).selectorText === '.wiki-sidebar'),
    ) as CSSMediaRule | undefined
    const sidebar = Array.from(mobileRules?.cssRules ?? []).find(
      (rule) => (rule as CSSStyleRule).selectorText === '.wiki-sidebar',
    ) as CSSStyleRule | undefined
    const backdrop = Array.from(mobileRules?.cssRules ?? []).find(
      (rule) => (rule as CSSStyleRule).selectorText === '.wiki-drawer-overlay',
    ) as CSSStyleRule | undefined
    // jsdom exposes the authored CSS geometry, not a visual layout. Worker/browser
    // acceptance checks the actual header pixels and stacking in the mobile viewport.
    expect(sidebar?.style.getPropertyValue('top')).toBe('var(--topbar-height, 0px)')
    expect(backdrop?.style.getPropertyValue('inset')).toBe('var(--topbar-height, 0px) 0 0')
    expect(backdrop?.style.getPropertyValue('z-index')).toBe('30')
    expect(sidebar?.style.getPropertyValue('z-index')).toBe('31')
    // Both stay below the shell header's z40, including the drawer's shadow.
  })

  it('preserves mobile page-tree focus restoration and Escape/backdrop dismissal', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
    const { container } = render(<WikiPageClient initial={seed()} />)
    const trigger = screen.getByRole('button', { name: 'Pages' })
    const sidebar = container.querySelector<HTMLElement>('#wiki-page-tree')!
    const backdrop = container.querySelector<HTMLElement>('.wiki-drawer-overlay')!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(sidebar.contains(document.activeElement)).toBe(true)
    expect(backdrop.classList.contains('wiki-drawer-overlay-open')).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(backdrop)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(backdrop.classList.contains('wiki-drawer-overlay-open')).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('submits search and filters through native GET and renders refreshed server result arrays directly', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    const result = {
      id: 'result',
      slug: 'result',
      title: 'Server search result',
      project_id: null,
      excerpt: null,
      type: null,
      status: null,
      tags: [],
      freshness: null,
    }
    const initial = {
      ...seed(),
      mode: 'read' as const,
      searchQuery: 'old',
      searchResults: [result],
    }
    const view = render(<WikiPageClient initial={initial} />)
    fireEvent.change(screen.getByLabelText('Search wiki pages'), { target: { value: 'new' } })
    fireEvent.change(screen.getByLabelText('Filter wiki pages by tags'), {
      target: { value: 'docs' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    const form = view.container.querySelector<HTMLFormElement>('form[method="get"]')
    if (!form) throw new Error('Missing native Wiki search form')
    expect(form.getAttribute('action')).toBe('/wiki/guide')
    const data = new FormData(form)
    expect(data.get('q')).toBe('new')
    expect(data.get('tags')).toBe('docs')
    expect(data.get('workspace')).toBe('team')
    expect(data.get('scope')).toBe('workspace')
    expect(screen.getByText('Server search result')).toBeTruthy()
    expect(getWikiPage).not.toHaveBeenCalled()
    expect(navigateFeature).not.toHaveBeenCalled()
    view.rerender(
      <WikiPageClient
        initial={{
          ...initial,
          searchQuery: 'new',
          filterTags: 'docs',
          searchResults: [{ ...result, title: 'Refreshed server result' }],
        }}
      />,
    )
    expect(screen.getByText('Refreshed server result')).toBeTruthy()
    expect(screen.queryByText('Server search result')).toBeNull()
  })
  it('uses one named ServerFn attachment file field and the shared backend File schema', async () => {
    const { container } = render(<WikiPageClient initial={{ ...seed(), mode: 'read' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Attach file/ }))
    const form = container.querySelector<HTMLInputElement>('input[type="hidden"][name="entityId"][value="page"]')?.form
    expect(form?.querySelector<HTMLInputElement>('input[name="workspaceSlug"]')?.value).toBe('team')
    expect(form?.querySelector<HTMLInputElement>('input[name="entityType"]')?.value).toBe('wiki_page')
    expect(form?.getAttribute('action')).not.toContain('/attachments/upload')
    expect(screen.getByText(/10 MiB including form data/)).toBeTruthy()
    expect(form?.querySelectorAll('input[type="file"][name="file"]')).toHaveLength(1)
    const input = form?.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).toBeTruthy()
    const file = new File(['x'], 'large.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1 })
    if (!input) throw new Error('Missing native attachment file input')
    fireEvent.change(input, {
      target: { files: [new File(['valid'], 'valid.png', { type: 'image/png' })] },
    })
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(false)
    fireEvent.change(input, { target: { files: [file] } })
    expect(screen.getByRole('button', { name: 'Upload' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alert').textContent).toBeTruthy()
    if (!form) throw new Error('Missing native attachment form')
    await act(async () => {
      expect(fireEvent.submit(form)).toBe(false)
    })
  })
  it('inserts inline image metadata through the named ServerFn without replacing the unsaved draft', async () => {
    vi.mocked(uploadInlineImage).mockResolvedValue({
      ok: true,
      value: { id: 'inline-file', filename: 'inline.png', contentType: 'image/png', size: 5 },
    })
    render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Unsaved draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Paste inline image' }))
    await waitFor(() => {
      expect((screen.getByLabelText('Markdown') as HTMLTextAreaElement).value).toBe(
        'Unsaved draft\n![inline](/api/files/inline-file?workspace=team)',
      )
    })
    expect(uploadInlineImage).toHaveBeenCalledWith({
      workspaceSlug: 'team',
      entityType: 'wiki_page',
      entityId: 'page',
      file: expect.any(File),
    })
    expect(saveWikiPage).not.toHaveBeenCalled()
  })
  it('preserves the unsaved draft when an inline ServerFn upload is rejected by request limits', async () => {
    vi.mocked(uploadInlineImage).mockResolvedValue({
      ok: false,
      status: 413,
      message: "Request body exceeds Effront's limit.",
    })
    render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Keep my draft' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Paste inline image' }))
    })
    expect(uploadInlineImage).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Markdown') as HTMLTextAreaElement).value).toBe('Keep my draft')
    expect(saveWikiPage).not.toHaveBeenCalled()
  })
  it('validates the TanStack draft before invoking a save and preserves the unsaved body', async () => {
    render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Keep my draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Use a title between 1 and 300 characters and content at most 500000 characters.'),
    ).toBeTruthy()
    expect(saveWikiPage).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Markdown') as HTMLTextAreaElement).value).toBe('Keep my draft')
  })
  it('retains editor content and exposes original overwrite controls on a revision conflict', async () => {
    vi.mocked(saveWikiPage).mockResolvedValue({ ok: false, status: 409, message: 'Conflict' })
    render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Markdown'), {
      target: { value: 'My conflicted body' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Overwrite with mine' })).toBeTruthy()
    expect((screen.getByLabelText('Markdown') as HTMLTextAreaElement).value).toBe('My conflicted body')
  })
  it('protects unsaved native navigation while allowing same-URL framework refresh', () => {
    const navigation = new EventTarget()
    vi.stubGlobal('navigation', navigation)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<WikiPageClient initial={seed()} />)
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Unsaved' } })
    const refreshed = Object.assign(new Event('navigate', { cancelable: true }), {
      destination: { url: window.location.href },
    })
    navigation.dispatchEvent(refreshed)
    expect(confirm).not.toHaveBeenCalled()
    const leaving = Object.assign(new Event('navigate', { cancelable: true }), {
      destination: { url: new URL('/wiki/other', window.location.href).href },
    })
    navigation.dispatchEvent(leaving)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(leaving.defaultPrevented).toBe(true)
  })
  it('does not perform initial client data loads and preserves edited title across same-URL refreshed props', async () => {
    const initial = seed()
    const view = render(<WikiPageClient initial={initial} />)
    expect(saveWikiPage).not.toHaveBeenCalled()
    expect(getWikiPage).not.toHaveBeenCalled()
    expect(getWikiDraft).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Unsaved title' } })
    view.rerender(
      <WikiPageClient
        initial={{
          ...initial,
          page: { ...initial.page, title: "Other person's title", revisionId: 'new-rev' },
        }}
      />,
    )
    expect((screen.getByLabelText('Page title') as HTMLInputElement).value).toBe('Unsaved title')
    view.unmount()
  })
  it('autosaves once and does not loop when mutation refresh adopts an equivalent page object', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    const initial = seed()
    const view = render(<WikiPageClient initial={initial} />)
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Unsaved body' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    expect(saveWikiDraft).toHaveBeenCalledTimes(1)
    expect(saveWikiDraft).toHaveBeenCalledWith({
      workspaceSlug: 'team',
      slug: 'guide',
      title: 'Guide',
      content: 'Unsaved body',
      baseRevisionId: 'rev',
      expectedDraftRevision: null,
    })
    view.rerender(<WikiPageClient initial={{ ...initial, page: { ...initial.page } }} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(saveWikiDraft).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Markdown') as HTMLTextAreaElement).value).toBe('Unsaved body')
  })
})
