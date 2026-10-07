import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vite-plus/test'

vi.mock('../../../attachment-actions', () => ({
  uploadAttachment: vi.fn(),
  uploadInlineImage: vi.fn(),
}))
vi.mock('../actions', () => ({
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  readIssue: vi.fn(),
  readIssuePage: vi.fn(),
  searchIssues: vi.fn(),
  readComments: vi.fn(),
  addComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  readLinks: vi.fn(),
  addIssueLink: vi.fn(),
  deleteIssueLink: vi.fn(),
  shareIssue: vi.fn(),
  readAttachments: vi.fn(),
  addAttachmentLink: vi.fn(),
  deleteAttachment: vi.fn(),
  searchWikiAttachments: vi.fn(),
  updateSprint: vi.fn(),
}))
vi.mock('@effront/core/query', async () => {
  const { Effect } = await import('effect')
  return {
    query: (operation: (input: unknown) => Promise<unknown>) => (input: unknown) =>
      Effect.tryPromise({ try: () => operation(input), catch: (error) => error }),
  }
})
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('max-width') ? window.innerWidth < 640 : window.innerWidth >= 640,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => true,
    }),
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
