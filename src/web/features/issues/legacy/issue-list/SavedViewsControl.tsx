'use client'
import { Button } from '../../../../components/generated/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../../../components/generated/dropdown-menu'
import type { useSavedViews } from './useSavedViews'

type Saved = ReturnType<typeof useSavedViews>

// Standard menu items keep selection and deletion keyboard-accessible without
// nesting action buttons inside a Select option or maintaining a custom menu.
function ViewsMenu({ saved }: { saved: Saved }) {
  const { savedViews, activeViewName, applyView, deleteView } = saved
  if (savedViews.length === 0) return null

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

function SaveViewControl({ saved }: { saved: Saved }) {
  const { showSaveInput, setShowSaveInput, saveViewName, setSaveViewName, doSaveView } = saved

  if (!showSaveInput) {
    return (
      <button
        type='button'
        onClick={() => setShowSaveInput(true)}
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
        onInput={(e) => setSaveViewName((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') doSaveView()
          if (e.key === 'Escape') {
            setSaveViewName('')
            setShowSaveInput(false)
          }
        }}
        placeholder='View name…'
        // biome-ignore lint/a11y/noAutofocus: intentional — triggered by user action
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
export default function SavedViewsControl({ saved }: { saved: Saved }) {
  return (
    <>
      <ViewsMenu saved={saved} />
      <SaveViewControl saved={saved} />
    </>
  )
}
