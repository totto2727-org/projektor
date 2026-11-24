'use client'
import { Array } from 'effect'
import type { JSX } from 'react'

import { Button } from '@/components/generated/button.tsx'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/generated/dropdown-menu.tsx'

import type { useSavedViews } from './use-saved-views.ts'

type Saved = ReturnType<typeof useSavedViews>

/*
 * Standard menu items keep selection and deletion keyboard-accessible without
 * nesting action buttons inside a Select option or maintaining a custom menu.
 */
const ViewsMenu = function ViewsMenu({ saved }: { saved: Saved }): undefined | JSX.Element {
  const { savedViews, activeViewName, applyView, deleteView } = saved
  if (Array.isArrayEmpty(savedViews)) {
    return undefined
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='outline' aria-label='Saved views' />}>
        {activeViewName ?? 'Views'}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {savedViews.map((view) => (
          <DropdownMenuItem key={view.name} onClick={() => applyView(view)}>
            {view.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {savedViews.map((view) => (
          <DropdownMenuItem key={view.name} variant='destructive' onClick={() => deleteView(view.name)}>
            Delete view {view.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const SaveViewControl = function SaveViewControl({ saved }: { saved: Saved }): JSX.Element {
  const { showSaveInput, setShowSaveInput, saveViewName, setSaveViewName, doSaveView } = saved

  if (!showSaveInput) {
    return (
      <button
        type='button'
        onClick={() => {
          setShowSaveInput(true)
        }}
        className='py-1 px-[0.625rem] rounded-full border border-border bg-bg text-text-muted cursor-pointer text-[0.8rem]'
      >
        Save view
      </button>
    )
  }

  return (
    <div className='flex items-center gap-1'>
      <input
        type='text'
        value={saveViewName}
        onInput={(event) => {
          setSaveViewName((event.target as HTMLInputElement).value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void doSaveView()
          }
          if (event.key === 'Escape') {
            setSaveViewName('')
            setShowSaveInput(false)
          }
        }}
        placeholder='View name…'
        // Intentional — triggered by user action
        autoFocus
        className='py-1 px-[0.625rem] border border-border rounded bg-bg text-text-base text-[0.8rem] outline-hidden w-32'
      />
      <button
        type='button'
        onClick={doSaveView}
        className='py-1 px-[0.625rem] rounded border border-border bg-bg text-text-base text-[0.8rem] cursor-pointer'
      >
        Save
      </button>
      <button
        type='button'
        aria-label='Cancel save view'
        onClick={() => {
          setSaveViewName('')
          setShowSaveInput(false)
        }}
        className='bg-transparent border-none text-text-muted cursor-pointer text-base px-1 leading-none'
      >
        ×
      </button>
    </div>
  )
}

/** Views dropdown (apply/delete saved views) + the "Save view" button/input. */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function SavedViewsControl({ saved }: { saved: Saved }): JSX.Element {
  return (
    <>
      <ViewsMenu saved={saved} />
      <SaveViewControl saved={saved} />
    </>
  )
}
