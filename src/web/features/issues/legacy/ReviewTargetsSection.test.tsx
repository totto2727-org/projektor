// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vite-plus/test'

vi.mock('../actions', () => ({ setAttachmentReviewStatus: vi.fn(), updateIssue: vi.fn() }))
vi.mock('./IssueDetailParts', () => ({
  AttachmentsSection: () => <p>Full attachments</p>,
  BodySection: () => <p>Full description</p>,
  ChildIssuesSection: () => null,
  CommentsSection: () => <p>Full comments</p>,
  ParentBadge: () => null,
  RefChip: ({ issueRef }: { issueRef: string }) => <span>{issueRef}</span>,
  RelationsSection: () => null,
  ShareButton: () => null,
  SidebarPanel: () => <p>Full sidebar</p>,
  TitleSection: ({ issue }: { issue: { title: string } }) => <h1>{issue.title}</h1>,
}))

import type { ReviewStatus } from '../../../../contracts/review-targets'
import { setAttachmentReviewStatus } from '../actions'
import type { Attachment } from '../types'
import type { IssueDetailInitialData } from '../views/IssueDetailPage'
import IssueDetail from './IssueDetail'
import { ReviewTargetsSection } from './ReviewTargetsSection'

function attachment(id: string, status?: ReviewStatus | null, kind: Attachment['kind'] = 'file'): Attachment {
  return {
    id,
    kind,
    filename: `${id}.pdf`,
    contentType: 'application/pdf',
    size: 10,
    url: kind === 'url' ? `https://example.com/${id}` : null,
    createdAt: 1,
    wikiPage: null,
    reviewStatus: status,
  }
}

const props = { workspaceSlug: 'workspace', issueId: 'issue', issueHref: '/issues/PROJ-1?workspace=workspace' }
const success = { ok: true, value: { ok: true } } satisfies Awaited<ReturnType<typeof setAttachmentReviewStatus>>

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it.each(['file', 'url'] as const)('selects one %s attachment independently, starting at fixing', async (kind) => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof setAttachmentReviewStatus>>>()
  vi.mocked(setAttachmentReviewStatus).mockReturnValue(pending.promise)
  const first = attachment('first', null, kind)
  const second = attachment('second')
  const wiki = attachment('wiki', null, 'wiki_ref')
  const attachments = [first, second, wiki]
  const { rerender } = render(<ReviewTargetsSection {...props} attachments={attachments} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'first.pdfをレビュー対象にする' }))
  expect(setAttachmentReviewStatus).toHaveBeenCalledExactlyOnceWith({
    workspaceSlug: 'workspace',
    issueId: 'issue',
    attachmentId: 'first',
    status: 'fixing',
  })
  expect(screen.getByRole('checkbox', { name: 'first.pdfをレビュー対象にする' })).toHaveProperty('checked', false)
  expect(screen.getByRole('checkbox', { name: 'first.pdfをレビュー対象にする' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('checkbox', { name: 'second.pdfをレビュー対象にする' })).toHaveProperty('disabled', false)
  expect(screen.queryByRole('checkbox', { name: 'wiki.pdfをレビュー対象にする' })).toBeNull()
  await act(async () => pending.resolve(success))
  expect(screen.getByRole('checkbox', { name: 'first.pdfをレビュー対象にする' })).toHaveProperty('disabled', true)
  rerender(<ReviewTargetsSection {...props} attachments={[{ ...first, reviewStatus: 'fixing' }, second, wiki]} />)
  expect(screen.getByRole('checkbox', { name: 'first.pdfをレビュー対象にする' })).toHaveProperty('checked', true)
  expect(screen.getByRole('combobox', { name: 'first.pdfのレビューステータス' })).toHaveProperty('value', 'fixing')
  expect(screen.getByRole('checkbox', { name: 'second.pdfをレビュー対象にする' })).toHaveProperty('checked', false)
})

it.each(['file', 'url'] as const)(
  'unselects one %s target without removing the attachment or other targets',
  async (kind) => {
    vi.mocked(setAttachmentReviewStatus).mockResolvedValue(success)
    const first = attachment('first', 'fixing', kind)
    const second = attachment('second', 'in_review')
    const { rerender } = render(<ReviewTargetsSection {...props} attachments={[first, second]} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'first.pdfをレビュー対象にする' }))
    await act(async () => {})
    expect(setAttachmentReviewStatus).toHaveBeenCalledExactlyOnceWith({
      workspaceSlug: 'workspace',
      issueId: 'issue',
      attachmentId: 'first',
      status: null,
    })
    rerender(<ReviewTargetsSection {...props} attachments={[{ ...first, reviewStatus: null }, second]} />)
    expect(screen.getByText('first.pdf')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'first.pdf' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'first.pdfをレビュー対象にする' })).toHaveProperty('checked', false)
    expect(screen.getByRole('checkbox', { name: 'second.pdfをレビュー対象にする' })).toHaveProperty('checked', true)
  },
)

it.each([
  ['fixing', 'in_review', 'レビュー中'],
  ['in_review', 'changes_requested', '要修正'],
  ['changes_requested', 'done', '完了'],
  ['in_review', 'fixing', '修正中'],
] satisfies [ReviewStatus, ReviewStatus, string][])(
  'changes %s to %s only after canonical props acknowledge it',
  async (from, to, label) => {
    vi.mocked(setAttachmentReviewStatus).mockResolvedValue(success)
    const first = attachment('first', from)
    const { rerender } = render(<ReviewTargetsSection {...props} attachments={[first]} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: to } })
    await act(async () => {})
    expect(setAttachmentReviewStatus).toHaveBeenCalledExactlyOnceWith({
      workspaceSlug: 'workspace',
      issueId: 'issue',
      attachmentId: 'first',
      status: to,
    })
    expect(screen.getByRole('combobox')).toHaveProperty('value', from)
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
    rerender(<ReviewTargetsSection {...props} attachments={[{ ...first, reviewStatus: to }]} />)
    if (to === 'done') {
      expect(screen.queryByRole('combobox')).toBeNull()
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(screen.queryByText('first.pdf')).toBeNull()
      expect(screen.getByRole('heading', { name: 'レビュー対象 (0)' })).toBeTruthy()
      expect(screen.getByText('表示するレビュー対象はありません。')).toBeTruthy()
    } else {
      expect(screen.getByRole('combobox')).toHaveProperty('value', to)
      expect(screen.getByRole('combobox')).toHaveProperty('disabled', false)
      expect(screen.getAllByText(label).length).toBe(2)
    }
  },
)

it.each([
  ['changes_requested', 'before'],
  ['fixing', 'before'],
  ['changes_requested', 'after'],
  ['fixing', 'after'],
] satisfies [ReviewStatus, 'before' | 'after'][])(
  'unlocks for canonical %s delivered %s save completion even when submitted in_review was superseded',
  async (canonicalStatus, refreshTiming) => {
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof setAttachmentReviewStatus>>>()
    vi.mocked(setAttachmentReviewStatus).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(success)
    const first = attachment('first', 'fixing')
    const { rerender } = render(<ReviewTargetsSection {...props} attachments={[first]} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'in_review' } })
    const refresh = () =>
      rerender(<ReviewTargetsSection {...props} attachments={[{ ...first, reviewStatus: canonicalStatus }]} />)
    if (refreshTiming === 'before') {
      refresh()
      expect(screen.getByRole('combobox')).toHaveProperty('value', canonicalStatus)
      expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'done' } })
      expect(setAttachmentReviewStatus).toHaveBeenCalledTimes(1)
    }
    await act(async () => pending.resolve(success))
    if (refreshTiming === 'after') {
      expect(screen.getByRole('combobox')).toHaveProperty('disabled', true)
      refresh()
    }
    expect(screen.getByRole('combobox')).toHaveProperty('value', canonicalStatus)
    expect(screen.getByRole('combobox')).toHaveProperty('disabled', false)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'in_review' } })
    await act(async () => {})
    expect(setAttachmentReviewStatus).toHaveBeenCalledTimes(2)
    expect(setAttachmentReviewStatus).toHaveBeenLastCalledWith({
      workspaceSlug: 'workspace',
      issueId: 'issue',
      attachmentId: 'first',
      status: 'in_review',
    })
  },
)

it('preserves canonical selection on delayed failure, while a separate target remains editable', async () => {
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof setAttachmentReviewStatus>>>()
  vi.mocked(setAttachmentReviewStatus).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(success)
  const first = attachment('first', 'in_review')
  const second = attachment('second', 'fixing')
  const { rerender } = render(<ReviewTargetsSection {...props} attachments={[first, second]} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'first.pdfのレビューステータス' }), {
    target: { value: 'done' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'second.pdfのレビューステータス' }), {
    target: { value: 'in_review' },
  })
  await act(async () => {})
  rerender(<ReviewTargetsSection {...props} attachments={[first, { ...second, reviewStatus: 'in_review' }]} />)
  await act(async () => pending.resolve({ ok: false, status: 409, message: 'Target changed. Refresh and try again.' }))
  expect(screen.getByRole('alert').textContent).toBe('Target changed. Refresh and try again.')
  expect(screen.getByRole('combobox', { name: 'first.pdfのレビューステータス' })).toHaveProperty('value', 'in_review')
  expect(screen.getByRole('combobox', { name: 'first.pdfのレビューステータス' })).toHaveProperty('disabled', false)
  expect(screen.getByRole('combobox', { name: 'second.pdfのレビューステータス' })).toHaveProperty('value', 'in_review')
  expect(setAttachmentReviewStatus).toHaveBeenCalledTimes(2)
})

it('handles a transport failure without exposing diagnostics or changing canonical selection', async () => {
  vi.mocked(setAttachmentReviewStatus).mockRejectedValue(new Error('Private database diagnostics'))
  render(<ReviewTargetsSection {...props} attachments={[attachment('first')]} />)
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => {})
  expect(screen.getByRole('alert').textContent).toBe(
    'レビューステータスを更新できませんでした。もう一度お試しください。',
  )
  expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  expect(screen.getByRole('checkbox')).toHaveProperty('disabled', false)
})

it('puts in-review targets first with deterministic ties and gives access links in the focused view', () => {
  render(
    <ReviewTargetsSection
      {...props}
      focused
      attachments={[
        attachment('z', 'fixing'),
        attachment('b', 'in_review', 'url'),
        attachment('a', 'in_review'),
        attachment('unused'),
      ]}
    />,
  )
  const list = screen.getByRole('list', { name: '選択済みのレビュー対象' })
  expect(
    within(list)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['a.pdf', 'b.pdf', 'z.pdf'])
  expect(screen.getByRole('link', { name: 'a.pdf' }).getAttribute('href')).toBe('/api/files/a?workspace=workspace')
  expect(screen.getByRole('link', { name: 'b.pdf' }).getAttribute('href')).toBe('https://example.com/b')
  expect(screen.getByRole('link', { name: '課題全体に戻る' }).getAttribute('href')).toBe(props.issueHref)
  expect(screen.getByText('レビュー待ち: 2件')).toBeTruthy()
  expect(screen.getByText('レビュー対象を選択 (1)').closest('details')).toHaveProperty('open', false)
})

it('renders a textual and colored no-review-needed indicator for mixed fixing and changes-requested targets', () => {
  render(
    <ReviewTargetsSection
      {...props}
      attachments={[attachment('first', 'changes_requested'), attachment('second', 'fixing')]}
    />,
  )
  expect(screen.getByText('現在レビューが必要な対象はありません').className).toContain('bg-success-bg')
  expect(
    within(screen.getByRole('combobox', { name: 'first.pdfのレビューステータス' })).getByRole('option', {
      name: '要修正',
    }),
  ).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'second.pdfのレビューステータス' })).toHaveProperty('value', 'fixing')
  for (const row of within(screen.getByRole('list', { name: '選択済みのレビュー対象' })).getAllByRole('listitem')) {
    expect(within(row).getByText('レビュー不要')).toBeTruthy()
    expect(row.className).toContain('text-text-muted')
    expect(row.className).not.toContain('border-accent')
  }
  expect(screen.getByRole('link', { name: 'レビュー対象に集中' }).getAttribute('href')).toBe(
    '/issues/PROJ-1?workspace=workspace&tab=review-targets',
  )
})

it.each([false, true])(
  'hides done names, controls and counts, and never offers them as candidates (focused=%s)',
  (focused) => {
    render(
      <ReviewTargetsSection
        {...props}
        focused={focused}
        attachments={[
          attachment('finished-file', 'done'),
          attachment('finished-url', 'done', 'url'),
          attachment('active', 'fixing'),
          attachment('candidate'),
        ]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'レビュー対象 (1)' })).toBeTruthy()
    expect(screen.queryByText('finished-file.pdf')).toBeNull()
    expect(screen.queryByText('finished-url.pdf')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'finished-file.pdfをレビュー対象にする' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'finished-url.pdfをレビュー対象にする' })).toBeNull()
    expect(screen.getByText('レビュー対象を選択 (1)')).toBeTruthy()
    expect(screen.queryAllByRole('checkbox', { hidden: true })).toHaveLength(2)
  },
)

it('shows active-empty guidance when every selected target is completed', () => {
  render(<ReviewTargetsSection {...props} focused attachments={[attachment('finished', 'done')]} />)
  expect(screen.getByRole('heading', { name: 'レビュー対象 (0)' })).toBeTruthy()
  expect(screen.getByText('表示するレビュー対象はありません。')).toBeTruthy()
  expect(screen.queryByText('finished.pdf')).toBeNull()
  expect(screen.queryByText(/レビュー対象を選択/)).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
})

it.each(['file', 'url'] as const)(
  'shows an unselected %s candidate as text with selection controls but no access link',
  (kind) => {
    render(<ReviewTargetsSection {...props} attachments={[attachment('candidate', null, kind)]} />)
    const candidates = screen.getByRole('list', { name: '選択できる添付ファイルとURL' })
    expect(within(candidates).getByText('candidate.pdf').tagName).toBe('SPAN')
    expect(within(candidates).queryByRole('link')).toBeNull()
    expect(within(candidates).getByRole('checkbox', { name: 'candidate.pdfをレビュー対象にする' })).toHaveProperty(
      'checked',
      false,
    )
  },
)

it('distinguishes reviewing rows from fixing and changes-requested rows in the same target list', () => {
  render(
    <ReviewTargetsSection
      {...props}
      attachments={[
        attachment('fixing', 'fixing'),
        attachment('review', 'in_review'),
        attachment('changes', 'changes_requested'),
      ]}
    />,
  )
  const rows = within(screen.getByRole('list', { name: '選択済みのレビュー対象' })).getAllByRole('listitem')
  for (const row of rows) {
    if (within(row).queryByRole('link', { name: 'review.pdf' })) {
      expect(row.className).toContain('border-accent')
      expect(row.className).toContain('bg-accent')
      expect(within(row).queryByText('レビュー不要')).toBeNull()
    } else {
      expect(row.className).toContain('text-text-muted')
      expect(row.className).not.toContain('border-accent')
      expect(within(row).getByText('レビュー不要')).toBeTruthy()
    }
  }
  expect(screen.getByText('レビュー待ち: 1件')).toBeTruthy()
})

it('renders focused issue context, status, access links, and back navigation on the server without full issue sections', () => {
  const initialData: IssueDetailInitialData = {
    issue: {
      id: 'issue',
      number: 1,
      title: 'Review this issue',
      body: 'Full body',
      priority: 'medium',
      project_id: 'project',
      project_key: 'PROJ',
      project_name: 'Project',
      assignee_id: null,
      assignee_name: null,
      parent_id: null,
      sprint_id: null,
      type_id: null,
      type_key: null,
      type_name: null,
      status_id: null,
      status_key: null,
      status_name: null,
      status_category: null,
      created_at: 1,
      updated_at: 1,
      customFields: [],
    },
    attachments: [attachment('spec', 'in_review')],
    comments: [],
    links: [],
    statuses: [],
    taskTypes: [],
    members: [],
    parent: null,
    children: [],
    currentUserId: 'user',
    reviewTargetsFocused: true,
  }
  const html = renderToStaticMarkup(<IssueDetail workspaceSlug='workspace' initialData={initialData} />)
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  expect(parsed.querySelector('h1')?.textContent).toBe('Review this issue')
  expect(parsed.querySelector('select')?.textContent).toBe('修正中レビュー中要修正完了')
  expect(parsed.querySelector('option[selected]')?.getAttribute('value')).toBe('in_review')
  expect(parsed.querySelector('a[href="/api/files/spec?workspace=workspace"]')?.textContent).toBe('spec.pdf')
  expect(parsed.body.textContent).toContain('課題全体に戻る')
  expect(parsed.body.textContent).not.toContain('Full description')
  expect(parsed.body.textContent).not.toContain('Full comments')
  expect(parsed.body.textContent).not.toContain('Full sidebar')
  expect(parsed.querySelector('noscript')?.textContent).toContain('JavaScript')
})
