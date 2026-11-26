'use client'

import type { JSX, ReactNode } from 'react'

import { Dialog as PrimitiveDialog, DialogContent, DialogTitle } from '@/components/generated/dialog.tsx'

export interface DialogProps {
  open: boolean
  onClose: () => void
  ariaLabel?: string
  title?: string
  class?: string
  className?: string
  children: ReactNode
}

/**
 * Base UI owns portals, modal focus, dismissal, and scroll locking.
 *
 * @param {DialogProps} props Controlled visibility, close handling, labels, styles, and dialog content.
 * @returns {JSX.Element} The Base UI dialog with the caller's body and accessible title.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Dialog = function Dialog({
  open,
  onClose,
  ariaLabel,
  title,
  class: legacyClass,
  className,
  children,
}: DialogProps): JSX.Element {
  return (
    <PrimitiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose()
        }
      }}
    >
      <DialogContent
        aria-label={ariaLabel}
        className={['max-h-[80dvh] overflow-y-auto sm:max-w-[480px]', legacyClass, className].filter(Boolean).join(' ')}
      >
        <DialogTitle className='sr-only'>{title ?? ariaLabel ?? 'Dialog'}</DialogTitle>
        {children}
      </DialogContent>
    </PrimitiveDialog>
  )
}
