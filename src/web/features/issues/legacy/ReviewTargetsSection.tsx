'use client'
import { useEffect, useRef, useState } from 'react'

import type { ReviewStatus } from '../../../../contracts/review-targets'
import { FunctionError, unwrapResult } from '../../../client/functions'
import { setAttachmentReviewStatus } from '../actions'
import type { Attachment } from '../types'

const STATUS_OPTIONS = [
  { value: 'fixing', label: '修正中', color: 'text-text-muted bg-surface' },
  { value: 'in_review', label: 'レビュー中', color: 'text-accent bg-surface' },
  { value: 'changes_requested', label: '要修正', color: 'text-text-muted bg-surface' },
  { value: 'done', label: '完了', color: 'text-text-base bg-success-bg' },
] satisfies { value: ReviewStatus; label: string; color: string }[]

function ReviewTargetRow({
  attachment,
  workspaceSlug,
  issueId,
}: {
  attachment: Attachment
  workspaceSlug: string
  issueId: string
}) {
  const status = attachment.reviewStatus ?? null
  const [pending, setPending] = useState<{ attachment: Attachment; saved: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const name = attachment.filename || attachment.url || 'Attachment'
  const option = STATUS_OPTIONS.find((entry) => entry.value === status)
  const href =
    attachment.kind === 'file'
      ? `/api/files/${encodeURIComponent(attachment.id)}?${new URLSearchParams({ workspace: workspaceSlug })}`
      : attachment.url

  useEffect(() => {
    if (pending?.saved && pending.attachment !== attachment) {
      setPending(null)
      busy.current = false
    }
  }, [attachment, pending])

  async function changeStatus(nextStatus: ReviewStatus | null) {
    if (busy.current) return
    busy.current = true
    setPending({ attachment, saved: false })
    setError(null)
    try {
      unwrapResult(
        await setAttachmentReviewStatus({ workspaceSlug, issueId, attachmentId: attachment.id, status: nextStatus }),
      )
      // A refreshed attachment acknowledges invalidation, even if another writer
      // has already superseded this status or reverted it to the original value.
      // Never unlock during the write, or copy the submitted status into the UI.
      setPending({ attachment, saved: true })
    } catch (cause) {
      setError(
        cause instanceof FunctionError
          ? cause.message
          : 'レビューステータスを更新できませんでした。もう一度お試しください。',
      )
      setPending(null)
      busy.current = false
    }
  }

  return (
    <li
      className={`border rounded-md p-3 min-w-0 ${status === 'in_review' ? 'border-accent bg-accent/10' : 'border-border bg-surface text-text-muted'}`}
      aria-busy={pending !== null}
    >
      <div className='flex flex-wrap items-center gap-3'>
        <label className='flex items-center gap-2 min-h-[44px]'>
          <input
            type='checkbox'
            checked={status !== null}
            disabled={pending !== null}
            aria-label={`${name}をレビュー対象にする`}
            onChange={(event) => void changeStatus(event.currentTarget.checked ? 'fixing' : null)}
            className='size-4 accent-accent'
          />
          <span className='text-sm'>対象</span>
        </label>
        {href && status !== null ? (
          <a
            href={href}
            target='_blank'
            rel='noreferrer'
            className='text-accent underline break-words flex-1 min-w-0 order-first basis-full sm:order-none sm:basis-auto'
          >
            {name}
          </a>
        ) : (
          <span className='break-words flex-1 min-w-0 order-first basis-full sm:order-none sm:basis-auto'>{name}</span>
        )}
        {option ? (
          <>
            <span className={`rounded px-2 py-1 text-sm font-medium ${option.color}`}>{option.label}</span>
            {status !== 'in_review' && <span className='text-xs text-text-muted'>レビュー不要</span>}
            <select
              aria-label={`${name}のレビューステータス`}
              value={status ?? ''}
              disabled={pending !== null}
              onChange={(event) => {
                const selected = STATUS_OPTIONS.find((entry) => entry.value === event.currentTarget.value)
                if (selected) void changeStatus(selected.value)
              }}
              className='min-h-[44px] max-w-full rounded border border-border bg-bg px-2 text-sm text-text-base'
            >
              {STATUS_OPTIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className='text-sm text-text-muted'>対象外</span>
        )}
      </div>
      {pending && (
        <p role='status' className='mt-2 text-sm text-text-muted'>
          更新中…
        </p>
      )}
      {error && (
        <p role='alert' className='mt-2 text-sm text-danger-text'>
          {error}
        </p>
      )}
    </li>
  )
}

export function ReviewTargetsSection({
  attachments,
  workspaceSlug,
  issueId,
  issueHref,
  focused = false,
}: {
  attachments: readonly Attachment[]
  workspaceSlug: string
  issueId: string
  issueHref: string
  focused?: boolean
}) {
  const eligible = attachments.filter((attachment) => attachment.kind === 'file' || attachment.kind === 'url')
  const selected = eligible
    .filter((attachment) => attachment.reviewStatus != null && attachment.reviewStatus !== 'done')
    .sort((left, right) => {
      const priority = Number(right.reviewStatus === 'in_review') - Number(left.reviewStatus === 'in_review')
      return priority || left.createdAt - right.createdAt || left.id.localeCompare(right.id, 'en')
    })
  const available = eligible.filter((attachment) => attachment.reviewStatus == null)
  const inReview = selected.filter((attachment) => attachment.reviewStatus === 'in_review').length
  const reviewHref = `${issueHref}${issueHref.includes('?') ? '&' : '?'}tab=review-targets`
  const rows = (items: readonly Attachment[], label: string) => (
    <ul aria-label={label} className='list-none p-0 m-0 flex flex-col gap-2'>
      {items.map((attachment) => (
        <ReviewTargetRow key={attachment.id} attachment={attachment} workspaceSlug={workspaceSlug} issueId={issueId} />
      ))}
    </ul>
  )

  return (
    <section className='mb-8 min-w-0' aria-label='レビュー対象'>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-3'>
        <h2 className='text-base font-semibold m-0'>レビュー対象 ({selected.length})</h2>
        <a
          href={focused ? issueHref : reviewHref}
          className='text-sm text-accent underline min-h-[44px] inline-flex items-center'
        >
          {focused ? '課題全体に戻る' : 'レビュー対象に集中'}
        </a>
      </div>
      <p className='text-sm text-text-muted mb-3'>
        添付ファイルとURLから、必要な対象だけを選択してください。選択すると「修正中」から始まります。
      </p>
      <p
        className={`text-sm rounded border border-border p-3 mb-3 ${inReview ? 'text-accent bg-surface' : 'text-text-base bg-success-bg'}`}
      >
        {inReview ? `レビュー待ち: ${inReview}件` : '現在レビューが必要な対象はありません'}
      </p>
      {selected.length ? (
        rows(selected, '選択済みのレビュー対象')
      ) : (
        <p className='text-sm text-text-muted mb-3'>表示するレビュー対象はありません。</p>
      )}
      {available.length > 0 && (
        <details className='mt-4' open={!focused}>
          <summary className='cursor-pointer min-h-[44px] text-sm font-medium'>
            レビュー対象を選択 ({available.length})
          </summary>
          {rows(available, '選択できる添付ファイルとURL')}
        </details>
      )}
      {eligible.length === 0 && (
        <p className='text-sm text-text-muted'>対象にできる添付ファイルまたはURLがありません。</p>
      )}
      <noscript>
        <p className='text-sm text-text-muted mt-3'>
          対象とステータスの変更にはJavaScriptが必要です。リンクから対象を開けます。
        </p>
      </noscript>
    </section>
  )
}
