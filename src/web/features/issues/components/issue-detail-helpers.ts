'use client'
import type { ReviewStatus } from '#contracts/review-targets.ts'
import {
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
  currentEpochMilliseconds,
} from '#contracts/time.ts'
import type { RenderedMarkdown } from '@/components/markdown/render.ts'

export { formatBytes } from '@/lib/file-size.ts'

import type { CustomFieldValue } from './board-utils.ts'

export type { CustomFieldValue, TaskStatus } from './board-utils.ts'

export interface IssueLink {
  id: string
  type: 'blocks' | 'blocked_by' | 'relates_to' | 'duplicates'
  linkedIssueId: string
  linkedIssueTitle: string
  linkedIssueNumber: number
  linkedIssueProjectKey: string
  linkedIssueStatusCategory: string
  createdById: string
  createdAt: number
}

export interface Attachment {
  id: string
  kind: 'file' | 'wiki_ref' | 'url'
  filename: string
  contentType: string
  size: number
  url: string | null
  createdAt: number
  reviewStatus: ReviewStatus | null
  wikiPage: { id: string; title: string; url: string } | null
}

export interface IssueData {
  workspaceSlug?: string
  id: string
  number: number
  title: string
  body: string | null
  renderedBody?: RenderedMarkdown
  priority: string
  assignee_id: string | null
  assignee_name: string | null
  parent_id: string | null
  project_key: string | null
  project_name: string | null
  type_id: string | null
  type_key: string | null
  type_name: string | null
  status_id: string | null
  status_key: string | null
  status_name: string | null
  status_category: string | null
  created_at: number
  updated_at: number
  customFields: CustomFieldValue[]
  rollup?: { total: number; done: number; remaining: number; byStatus: Record<string, number> }
}

export interface Comment {
  id: string
  body: string
  renderedBody?: RenderedMarkdown
  author_id: string
  author_name: string
  author_email: string
  created_at: number
}

export interface Member {
  id: string
  name: string | null
  email: string
}

export interface TaskType {
  id: string
  key: string
  name: string
}

export const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'var(--priority-urgent-bg)', text: 'var(--priority-urgent-text)' },
  high: { bg: 'var(--priority-high-bg)', text: 'var(--priority-high-text)' },
  medium: { bg: 'var(--priority-medium-bg)', text: 'var(--priority-medium-text)' },
  low: { bg: 'var(--priority-low-bg)', text: 'var(--priority-low-text)' },
  none: { bg: 'var(--priority-none-bg)', text: 'var(--priority-none-text)' },
}

export const LINK_TYPE_LABELS: Record<string, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  relates_to: 'Relates to',
  duplicates: 'Duplicates',
}

export const LINK_TYPE_OPTIONS = [
  { label: 'Relates to', value: 'relates_to' },
  { label: 'Blocks', value: 'blocks' },
  { label: 'Blocked by', value: 'blocked_by' },
  { label: 'Duplicates', value: 'duplicates' },
]

const RELATIVE_DATE_WINDOW_DAYS = 7
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const formatDate = function formatDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * MILLISECONDS_PER_SECOND)
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

export const relativeTime = function relativeTime(unixSeconds: number): string {
  const diff = currentEpochMilliseconds() / MILLISECONDS_PER_SECOND - unixSeconds
  if (diff < SECONDS_PER_MINUTE) {
    return 'just now'
  }
  if (diff < SECONDS_PER_HOUR) {
    return `${Math.floor(diff / SECONDS_PER_MINUTE)}m ago`
  }
  if (diff < SECONDS_PER_DAY) {
    return `${Math.floor(diff / SECONDS_PER_HOUR)}h ago`
  }
  if (diff < RELATIVE_DATE_WINDOW_DAYS * SECONDS_PER_DAY) {
    return `${Math.floor(diff / SECONDS_PER_DAY)}d ago`
  }
  return formatDate(unixSeconds)
}
