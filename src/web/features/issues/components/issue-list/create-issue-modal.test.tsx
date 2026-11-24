/*
 * PROJ-566 / CD-294: the Description caption must not *wrap* the markdown editor.
 * A <label> with no `for` binds to its first labelable descendant, which inside
 * MarkdownEditor is the toolbar's Bold button — so every click in the editor body
 * was forwarded to Bold and wrapped subsequent typing in `**`.
 */
import { render, screen } from '@testing-library/react'

import '@/features/issues/test/browser.ts'
// @vitest-environment jsdom
import { Iterable } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import type { TaskStatus } from '@/features/issues/components/board-utils.ts'

import CreateIssueModal from './create-issue-modal.tsx'
import { useCreateIssueModal } from './use-create-issue-modal.ts'

const PROJECTS = [{ id: 'p1', key: 'PROJ', name: 'Projektor', description: null, workspace_slug: 'test-workspace' }]

function Harness() {
  const modal = useCreateIssueModal({
    filterProject: '',
    projects: PROJECTS,
  })
  return <CreateIssueModal {...modal} projects={PROJECTS} taskTypes={[]} statuses={[]} />
}

describe('covers CreateIssueModal — Description caption (PROJ-566)', () => {
  test('renders the Description label as a caption with no implicit control', () => {
    render(<Harness />)

    const caption = screen.getByText('Description')
    expect(caption.tagName).toBe('LABEL')
    /*
     * The assertion that fails on the old markup: a wrapping label captures the
     * editor's first labelable descendant (the Bold button, or the lazy fallback's
     * textarea before the chunk lands) as its implicit control.
     */
    expect((caption as HTMLLabelElement).control).toBeNull()
  })

  test('gives the editor its own accessible name instead', async () => {
    render(<Harness />)
    await expect(screen.findByLabelText('Description')).resolves.toBeTruthy()
  })
})

const TWO_PROJECTS = [
  ...PROJECTS,
  { id: 'p2', key: 'OTHER', name: 'Other', description: null, workspace_slug: 'test-workspace' },
]
const TASK_TYPES = [{ id: 't1', key: 'BUG', name: 'Bug' }]
const STATUSES: TaskStatus[] = [{ id: 's1', key: 'todo', name: 'To do', category: 'todo', color: null }]

function FieldsHarness() {
  const modal = useCreateIssueModal({
    filterProject: '',
    projects: TWO_PROJECTS,
  })
  return <CreateIssueModal {...modal} projects={TWO_PROJECTS} taskTypes={TASK_TYPES} statuses={STATUSES} />
}

/*
 * PROJ-566 (same class, other fields): the Project/Priority/Type/Status captions
 * wrapped their <Select>. A <label> with no `for` binds to its first labelable
 * descendant — Select's trigger <button> — and forwards clicks from every
 * non-interactive descendant to it, including the menu's own <li> options.
 */
describe('covers CreateIssueModal — Select field captions (PROJ-566)', () => {
  Iterable.forEach(['Project', 'Priority', 'Type', 'Status'], (caption) => {
    test(`renders the ${caption} label as a caption with no implicit control`, () => {
      render(<FieldsHarness />)
      const label = screen.getByText(caption, { selector: 'label' }) as HTMLLabelElement
      expect(label.control).toBeNull()
    })
  })

  test('leaves each Select named by its own ariaLabel', () => {
    render(<FieldsHarness />)
    Iterable.forEach(['Select project', 'Select priority', 'Select type', 'Select status'], (name) => {
      expect(screen.getByRole('combobox', { name })).toBeTruthy()
    })
  })
})
