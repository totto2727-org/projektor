// @vitest-environment jsdom
'use client'

import '@/features/issues/test/browser.ts'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import type { SavedViewFilters } from '@/features/issues/components/saved-views.ts'

import SavedViewsControl from './SavedViewsControl.tsx'
import { useSavedViews } from './useSavedViews.ts'

afterEach(cleanup)

const EMPTY_FILTERS: SavedViewFilters = {
  statuses: [],
  priorities: [],
  project: 'PROJ',
  type: '',
  epicId: '',
  sprintId: '',
  hideEpics: false,
  dateField: '',
  dateFrom: '',
  dateTo: '',
}

function seedViews(names: string[]) {
  sessionStorage.setItem(
    'issue-views-user-a:workspace:PROJ',
    JSON.stringify(names.map((name) => ({ name, filters: EMPTY_FILTERS }))),
  )
}

function Harness({ onApply }: { onApply: (f: SavedViewFilters) => void }) {
  const saved = useSavedViews('PROJ', EMPTY_FILTERS, onApply, 'workspace', 'user-a')
  return <SavedViewsControl saved={saved} />
}

beforeEach(() => sessionStorage.clear())

// Standard Base UI menus own pointer, focus and keyboard interaction.
describe('SavedViewsControl — generated menu', () => {
  test('renders nothing when there are no saved views', () => {
    render(<Harness onApply={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Saved views' })).toBeNull()
  })

  test('shows the placeholder label until a view is applied', async () => {
    seedViews(['Sprint board'])
    render(<Harness onApply={() => {}} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved views' }).textContent).toContain('Views'))
  })

  test('applies a view on selection and updates the trigger label', async () => {
    seedViews(['Sprint board', 'My bugs'])
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await waitFor(() => screen.getByRole('button', { name: 'Saved views' }))
    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'My bugs' }))

    expect(onApply).toHaveBeenCalledWith(EMPTY_FILTERS)
    expect(screen.getByRole('button', { name: 'Saved views' }).textContent).toContain('My bugs')
  })

  test('deletes a view via its trailing action without applying it', async () => {
    seedViews(['Sprint board', 'My bugs'])
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await waitFor(() => screen.getByRole('button', { name: 'Saved views' }))
    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'My bugs' }))
    onApply.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Saved views' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete view Sprint board' }))

    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Sprint board' })).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('issue-views-user-a:workspace:PROJ') ?? '[]')).toHaveLength(1)
  })

  test('deletes a view through the standard keyboard menu action without applying it', async () => {
    seedViews(['Sprint board', 'My bugs'])
    const onApply = vi.fn()
    render(<Harness onApply={onApply} />)

    await waitFor(() => screen.getByRole('button', { name: 'Saved views' }))
    const trigger = screen.getByRole('button', { name: 'Saved views' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const remove = await screen.findByRole('menuitem', { name: 'Delete view Sprint board' })
    remove.focus()
    fireEvent.keyDown(remove, { key: 'Enter' })
    expect(onApply).not.toHaveBeenCalled()

    expect(screen.queryByRole('menuitem', { name: 'Sprint board' })).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('issue-views-user-a:workspace:PROJ') ?? '[]')).toHaveLength(1)
  })
})
