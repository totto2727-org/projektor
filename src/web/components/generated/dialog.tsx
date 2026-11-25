'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/generated/button'
// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Dialog = function Dialog({ ...props }: DialogPrimitive.Root.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve controlled state, lifecycle callbacks and children on the Base UI Root.
  return <DialogPrimitive.Root data-slot='dialog' {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogTrigger = function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's render, event and accessibility props on the Base UI Trigger.
  return <DialogPrimitive.Trigger data-slot='dialog-trigger' {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogPortal = function DialogPortal({ ...props }: DialogPrimitive.Portal.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the Base UI Portal container option and children.
  return <DialogPrimitive.Portal data-slot='dialog-portal' {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogClose = function DialogClose({ ...props }: DialogPrimitive.Close.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's render, event and accessibility props on the Base UI Close.
  return <DialogPrimitive.Close data-slot='dialog-close' {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogOverlay = function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props): React.JSX.Element {
  return (
    <DialogPrimitive.Backdrop
      data-slot='dialog-overlay'
      className={cn(
        'fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve caller attributes and event handlers on the Base UI Backdrop.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogContent = function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}): React.JSX.Element {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot='dialog-content'
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's focus, event and accessibility props on the Base UI Popup.
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot='dialog-close'
            render={<Button variant='ghost' className='absolute top-2 right-2' size='icon-sm' />}
          >
            <XIcon />
            <span className='sr-only'>Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogHeader = function DialogHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
  return <div data-slot='dialog-header' className={cn('flex flex-col gap-2', className)} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogFooter = function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}): React.JSX.Element {
  return (
    <div
      data-slot='dialog-footer'
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    >
      {children}
      {showCloseButton && <DialogPrimitive.Close render={<Button variant='outline' />}>Close</DialogPrimitive.Close>}
    </div>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogTitle = function DialogTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props): React.JSX.Element {
  return (
    <DialogPrimitive.Title
      data-slot='dialog-title'
      className={cn('font-heading text-base leading-none font-medium', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve caller attributes and event handlers on the Base UI Title.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const DialogDescription = function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props): React.JSX.Element {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve caller attributes and event handlers on the Base UI Description.
      {...props}
    />
  )
}
