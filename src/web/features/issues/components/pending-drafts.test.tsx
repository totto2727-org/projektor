// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, afterEach, expect, test, vi } from 'vite-plus/test'

import { JSON_NULL } from '#tests/json-null.ts'
import { addComment, editComment, updateIssue } from '@/features/issues/actions.ts'
import { draftKey, loadDraft } from '@/features/issues/utils/drafts.ts'

import type { IssueData } from './issue-detail-helpers.ts'
import { BodySection, CommentsSection } from './issue-detail-parts.tsx'

vi.mock('../../../components/attachment-upload.tsx', () => ({ AttachmentUpload: () => null }))
vi.mock('../../../effront', () => ({ EFFRONT: { ServerFn: { make: vi.fn(() => vi.fn()) } } }))
vi.mock('../actions', () => ({
  updateIssue: vi.fn(),
  addComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  addAttachmentLink: vi.fn(),
  addIssueLink: vi.fn(),
  deleteAttachment: vi.fn(),
  deleteIssueLink: vi.fn(),
  readIssue: vi.fn(),
  searchWikiAttachments: vi.fn(),
  shareIssue: vi.fn(),
}))
vi.mock(import('./lazy-markdown-editor.tsx'), () => ({
  IssueMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label='Markdown draft'
      value={value}
      onChange={(event) => {
        onChange(event.currentTarget.value)
      }}
    />
  ),
}))
vi.mock(import('@/components/markdown/markdown-preview.tsx'), () => ({
  MarkdownPreview: ({ content }: { content: string }) => <p>{content}</p>,
}))

const issue: IssueData = {
  id: 'issue',
  number: 1,
  title: 'Issue',
  body: 'Original body',
  priority: 'medium',
  assignee_id: JSON_NULL,
  assignee_name: JSON_NULL,
  parent_id: JSON_NULL,
  project_key: 'PROJ',
  project_name: 'Project',
  type_id: JSON_NULL,
  type_key: JSON_NULL,
  type_name: JSON_NULL,
  status_id: JSON_NULL,
  status_key: JSON_NULL,
  status_name: JSON_NULL,
  status_category: JSON_NULL,
  created_at: 1,
  updated_at: 1,
  customFields: [],
}

function deferred<T>() {
  const { promise, resolve } = Promise.withResolvers<T>()
  return { promise, resolve }
}

describe('covers pending issue drafts', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  test('keeps a description edited while the submitted description is saving', async () => {
    expect.hasAssertions()
    const pending = deferred<Awaited<ReturnType<typeof updateIssue>>>()
    vi.mocked(updateIssue).mockReturnValue(pending.promise)
    render(<BodySection issue={issue} issueId='issue' workspaceSlug='workspace' currentUserId='user' />)
    fireEvent.click(screen.getByTitle('Edit description'))
    fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'Submitted body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(updateIssue).toHaveBeenCalledWith({
        issueId: 'issue',
        patch: { body: 'Submitted body' },
        workspaceSlug: 'workspace',
      })
    })
    fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'Newer body' } })
    await act(async () => {
      pending.resolve({ ok: true, value: { ok: true } })
    })
    expect(screen.getByDisplayValue('Newer body')).toBeInstanceOf(Element)
    expect(loadDraft(draftKey('workspace', 'user:issue', 'body'))).toBe('Newer body')
  })

  test('keeps the saved draft visible until canonical description props commit', async () => {
    expect.hasAssertions()
    const pending = deferred<Awaited<ReturnType<typeof updateIssue>>>()
    vi.mocked(updateIssue).mockReturnValue(pending.promise)
    const emptyIssue = { ...issue, body: '' }
    const { rerender } = render(
      <BodySection issue={emptyIssue} issueId='issue' workspaceSlug='workspace' currentUserId='user' />,
    )
    fireEvent.click(screen.getByTitle('Edit description'))
    fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'Canonical saved body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(updateIssue).toHaveBeenCalled()
    })
    await act(async () => {
      pending.resolve({ ok: true, value: { ok: true } })
    })
    expect(screen.getByDisplayValue('Canonical saved body')).toBeInstanceOf(Element)
    expect(screen.queryByText('No description.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true)
    expect(loadDraft(draftKey('workspace', 'user:issue', 'body'))).toBe('Canonical saved body')
    rerender(
      <BodySection
        issue={{ ...emptyIssue, body: 'Canonical saved body' }}
        issueId='issue'
        workspaceSlug='workspace'
        currentUserId='user'
      />,
    )
    expect(screen.queryByLabelText('Markdown draft')).toBeNull()
    expect(screen.getByText('Canonical saved body')).toBeInstanceOf(Element)
    expect(loadDraft(draftKey('workspace', 'user:issue', 'body'))).toBeNull()
  })

  test('keeps edits made after mutation success while canonical refresh is pending', async () => {
    expect.hasAssertions()
    const pending = deferred<Awaited<ReturnType<typeof updateIssue>>>()
    vi.mocked(updateIssue).mockReturnValue(pending.promise)
    const { rerender } = render(
      <BodySection issue={issue} issueId='issue' workspaceSlug='workspace' currentUserId='user' />,
    )
    fireEvent.click(screen.getByTitle('Edit description'))
    fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'Submitted body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(updateIssue).toHaveBeenCalled()
    })
    await act(async () => {
      pending.resolve({ ok: true, value: { ok: true } })
    })
    fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'Newer local body' } })
    rerender(
      <BodySection
        issue={{ ...issue, body: 'Submitted body' }}
        issueId='issue'
        workspaceSlug='workspace'
        currentUserId='user'
      />,
    )
    expect(screen.getByDisplayValue('Newer local body')).toBeInstanceOf(Element)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false)
    expect(loadDraft(draftKey('workspace', 'user:issue', 'body'))).toBe('Newer local body')
  })

  test('keeps the next comment typed while a previous comment is posting', async () => {
    expect.hasAssertions()
    const pending = deferred<Awaited<ReturnType<typeof addComment>>>()
    vi.mocked(addComment).mockReturnValue(pending.promise)
    render(<CommentsSection issueId='issue' workspaceSlug='workspace' comments={[]} currentUserId='user' />)
    fireEvent.input(screen.getByPlaceholderText('Add a comment…'), { target: { value: 'Submitted comment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => {
      expect(addComment).toHaveBeenCalledWith({
        body: 'Submitted comment',
        issueId: 'issue',
        workspaceSlug: 'workspace',
      })
    })
    fireEvent.input(screen.getByPlaceholderText('Add a comment…'), { target: { value: 'Next comment' } })
    await act(async () => {
      pending.resolve({ ok: true, value: { id: 'created-comment' } })
    })
    expect(screen.getByDisplayValue('Next comment')).toBeInstanceOf(Element)
    expect(loadDraft(draftKey('workspace', 'user:issue', 'comment'))).toBe('Next comment')
    expect(screen.getByRole('button', { name: 'Comment' })).toHaveProperty('disabled', false)
  })

  test('keeps a newer comment edit visible after the submitted edit saves', async () => {
    expect.hasAssertions()
    const pending = deferred<Awaited<ReturnType<typeof editComment>>>()
    vi.mocked(editComment).mockReturnValue(pending.promise)
    render(
      <CommentsSection
        issueId='issue'
        comments={[
          {
            id: 'comment',
            body: 'Original comment',
            author_id: 'user',
            author_name: 'User',
            author_email: 'user@example.com',
            created_at: 1,
          },
        ]}
        currentUserId='user'
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Submitted edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(editComment).toHaveBeenCalledWith({
        body: 'Submitted edit',
        commentId: 'comment',
        issueId: 'issue',
        workspaceSlug: undefined,
      })
    })
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Newer edit' } })
    await act(async () => {
      pending.resolve({ ok: true, value: { ok: true } })
    })
    expect(screen.getByDisplayValue('Newer edit')).toBeInstanceOf(Element)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false)
  })

  test('retains a failed description draft and allows retry until canonical acknowledgement', async () => {
    expect.hasAssertions()
    vi.mocked(updateIssue)
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({ ok: true, value: { ok: true } })
    const { rerender } = render(
      <BodySection issue={issue} issueId='issue' workspaceSlug='workspace' currentUserId='user' />,
    )
    fireEvent.click(screen.getByTitle('Edit description'))
    fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'Retry body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(screen.getByDisplayValue('Retry body')).toBeInstanceOf(Element)
    expect(loadDraft(draftKey('workspace', 'user:issue', 'body'))).toBe('Retry body')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(updateIssue).toHaveBeenCalledTimes(2)
    })
    rerender(
      <BodySection
        issue={{ ...issue, body: 'Retry body' }}
        issueId='issue'
        workspaceSlug='workspace'
        currentUserId='user'
      />,
    )
    await waitFor(() => {
      expect(screen.queryByLabelText('Markdown draft')).toBeNull()
    })
    expect(loadDraft(draftKey('workspace', 'user:issue', 'body'))).toBeNull()
  })

  test('retains a failed comment draft and clears it only after a successful retry', async () => {
    expect.hasAssertions()
    vi.mocked(addComment)
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({ ok: true, value: { id: 'created-comment' } })
    render(<CommentsSection issueId='issue' workspaceSlug='workspace' comments={[]} currentUserId='user' />)
    fireEvent.input(screen.getByPlaceholderText('Add a comment…'), { target: { value: 'Retry comment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await screen.findByRole('alert')
    expect(screen.getByDisplayValue('Retry comment')).toBeInstanceOf(Element)
    expect(loadDraft(draftKey('workspace', 'user:issue', 'comment'))).toBe('Retry comment')
    expect(screen.getByRole('button', { name: 'Comment' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Add a comment…')).toHaveProperty('value', '')
    })
    expect(addComment).toHaveBeenCalledTimes(2)
    expect(loadDraft(draftKey('workspace', 'user:issue', 'comment'))).toBeNull()
  })

  test('retains a failed comment edit and allows it to be retried', async () => {
    expect.hasAssertions()
    vi.mocked(editComment)
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({ ok: true, value: { ok: true } })
    render(
      <CommentsSection
        issueId='issue'
        comments={[
          {
            id: 'comment',
            body: 'Original comment',
            author_id: 'user',
            author_name: 'User',
            author_email: 'user@example.com',
            created_at: 1,
          },
        ]}
        currentUserId='user'
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Retry edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(screen.getByDisplayValue('Retry edit')).toBeInstanceOf(Element)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByDisplayValue('Retry edit')).toBeNull()
    })
    expect(editComment).toHaveBeenCalledTimes(2)
  })

  test('protects only comment edits that differ from their original body', () => {
    render(
      <CommentsSection
        issueId='issue'
        comments={[
          {
            id: 'comment',
            body: 'Original comment',
            author_id: 'user',
            author_name: 'User',
            author_email: 'user@example.com',
            created_at: 1,
          },
        ]}
        currentUserId='user'
      />,
    )
    function unloadPrevented(): boolean {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(unloadPrevented()).toBe(false)
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Changed comment' } })
    expect(unloadPrevented()).toBe(true)
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Original comment' } })
    expect(unloadPrevented()).toBe(false)
    fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Changed again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(unloadPrevented()).toBe(false)
  })
})
