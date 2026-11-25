'use client'

import type { JSX, ComponentType } from 'react'
import { useEffect, useState } from 'react'

import type * as MarkdownEditorModule from './markdown-editor.tsx'

// React Compiler does not yet lower dynamic imports inside components or effects.
// This module loader is still called lazily by the mount effect below.
const loadMarkdownEditor = (): Promise<typeof MarkdownEditorModule> => import('./markdown-editor.tsx')

// Keep the native input usable while the enhanced editor loads.
// Once editing starts, retain that control until this editor unmounts.
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const EditorFallback = function EditorFallback({
  value,
  onChange,
  minHeight,
  ariaLabel = 'Markdown editor',
  onFocus,
}: MarkdownEditorModule.Props & { onFocus: () => void }): JSX.Element {
  return (
    <div className='flex flex-col border border-border rounded overflow-hidden bg-bg normal-case font-normal'>
      <div
        className={
          'px-2 py-[2px] text-[0.7rem] text-text-muted bg-surface border-b border-border ' +
          'shrink-0 uppercase tracking-[0.06em]'
        }
      >
        Markdown editor
      </div>
      <textarea
        value={value}
        onInput={(event) => {
          onChange(event.currentTarget.value)
        }}
        onFocus={onFocus}
        aria-label={ariaLabel}
        style={{ minHeight }}
        className='w-full px-3 py-2 border-0 resize-y box-border bg-bg text-text-base font-mono
					text-base sm:text-sm leading-[1.6] focus:outline-hidden'
      />
    </div>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function LazyMarkdownEditor(props: MarkdownEditorModule.Props): JSX.Element {
  const [Editor, setEditor] = useState<ComponentType<MarkdownEditorModule.Props> | null>(null)
  const [fallbackInteracted, setFallbackInteracted] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadMarkdownEditor()
      .then((selectedModule) => {
        // Wrapped in a thunk: a bare component would be read as a state updater.
        if (!cancelled) {
          setEditor(() => selectedModule.MarkdownEditor)
        }
      })
      .catch((err) => {
        /*
         * PROJ-506: an unhandled rejection here (chunk-load failure on a flaky
         * connection in prod, or the import resolving after a test's jsdom
         * environment has already torn down) otherwise surfaces as an uncaught
         * error with no indication of what failed. The user already has a
         * working fallback textarea regardless, so there's nothing to recover.
         */
        if (!cancelled) {
          console.error('Failed to load the markdown editor', err)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Retain the native control after interaction, including blur before a Save click.
  return Editor && !fallbackInteracted ? (
    <Editor {...props} />
  ) : (
    <EditorFallback
      {...props}
      onFocus={() => {
        setFallbackInteracted(true)
      }}
    />
  )
}
