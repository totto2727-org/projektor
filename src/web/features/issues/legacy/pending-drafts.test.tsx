// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vite-plus/test'

vi.mock('../../../components/AttachmentUpload', () => ({ AttachmentUpload: () => null }))
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
vi.mock('./LazyMarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label='Markdown draft' value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  ),
}))
vi.mock('../../../components/markdown/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <p>{content}</p>,
}))

import { addComment, editComment, updateIssue } from '../actions'
import { draftKey, loadDraft } from '../utils/drafts'
import type { IssueData } from './issue-detail-helpers'
import { BodySection, CommentsSection } from './IssueDetailParts'

const issue: IssueData = {
  id: 'issue',
  number: 1,
  title: 'Issue',
  body: 'Original body',
  priority: 'medium',
  assignee_id: null,
  assignee_name: null,
  parent_id: null,
  project_key: 'PROJ',
  project_name: 'Project',
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
}

function deferred<T>() {
  const { promise, resolve } = Promise.withResolvers<T>()
  return { promise, resolve }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

it('keeps a description edited while the submitted description is saving', async () => {
  const pending = deferred<Awaited<ReturnType<typeof updateIssue>>>()
  vi.mocked(updateIssue).mockReturnValue(pending.promise)
  render(<BodySection issue={issue} issueId='issue' workspaceSlug='workspace' currentUserId='user' />)
  fireEvent.click(screen.getByTitle('Edit description'))
  fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'Submitted body' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(updateIssue).toHaveBeenCalledWith({
      workspaceSlug: 'workspace',
      issueId: 'issue',
      patch: { body: 'Submitted body' },
    }),
  )
  fireEvent.change(screen.getByLabelText('Markdown draft'), { target: { value: 'Newer body' } })
  await act(async () => pending.resolve({ ok: true, value: { ok: true } }))
  expect(screen.getByDisplayValue('Newer body')).toBeTruthy()
  expect(loadDraft(draftKey('workspace', 'user:issue', 'body'))).toBe('Newer body')
})

it('keeps the next comment typed while a previous comment is posting', async () => {
  const pending = deferred<Awaited<ReturnType<typeof addComment>>>()
  vi.mocked(addComment).mockReturnValue(pending.promise)
  render(<CommentsSection issueId='issue' workspaceSlug='workspace' comments={[]} currentUserId='user' />)
  fireEvent.input(screen.getByPlaceholderText('Add a comment…'), { target: { value: 'Submitted comment' } })
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }))
  await waitFor(() =>
    expect(addComment).toHaveBeenCalledWith({
      workspaceSlug: 'workspace',
      issueId: 'issue',
      body: 'Submitted comment',
    }),
  )
  fireEvent.input(screen.getByPlaceholderText('Add a comment…'), { target: { value: 'Next comment' } })
  await act(async () => pending.resolve({ ok: true, value: { id: 'created-comment' } }))
  expect(screen.getByDisplayValue('Next comment')).toBeTruthy()
  expect(loadDraft(draftKey('workspace', 'user:issue', 'comment'))).toBe('Next comment')
})

it('keeps a newer comment edit visible after the submitted edit saves', async () => {
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
  await waitFor(() =>
    expect(editComment).toHaveBeenCalledWith({
      workspaceSlug: undefined,
      issueId: 'issue',
      commentId: 'comment',
      body: 'Submitted edit',
    }),
  )
  fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Newer edit' } })
  await act(async () => pending.resolve({ ok: true, value: { ok: true } }))
  expect(screen.getByDisplayValue('Newer edit')).toBeTruthy()
})
