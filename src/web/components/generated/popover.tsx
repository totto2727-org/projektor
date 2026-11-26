'use client'

import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import * as React from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Popover = function Popover({ ...props }: PopoverPrimitive.Root.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve controlled state, lifecycle callbacks and children on the Base UI Root.
  return <PopoverPrimitive.Root data-slot='popover' {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const PopoverTrigger = function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's render, event and accessibility props on the Base UI Trigger.
  return <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const PopoverContent = function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>): React.JSX.Element {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        // oxlint-disable-next-line react/forbid-component-props -- Base UI Popover Positioner applies these classes to its own rendered element.
        className='isolate z-50'
      >
        <PopoverPrimitive.Popup
          data-slot='popover-content'
          // oxlint-disable-next-line react/forbid-component-props -- Base UI Popover Popup applies these classes to its own rendered element.
          className={cn(
            'z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's focus, event and accessibility props on the Base UI Popup.
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const PopoverHeader = function PopoverHeader({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
  return <div data-slot='popover-header' className={cn('flex flex-col gap-0.5 text-sm', className)} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const PopoverTitle = function PopoverTitle({
  className,
  ...props
}: PopoverPrimitive.Title.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading, react/forbid-component-props -- Preserve caller attributes and event handlers on the Base UI Title. Base UI Popover Title applies these classes to its own rendered element.
  return <PopoverPrimitive.Title data-slot='popover-title' className={cn('font-medium', className)} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const PopoverDescription = function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props): React.JSX.Element {
  return (
    <PopoverPrimitive.Description
      data-slot='popover-description'
      // oxlint-disable-next-line react/forbid-component-props -- Base UI Popover Description applies these classes to its own rendered element.
      className={cn('text-muted-foreground', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve caller attributes and event handlers on the Base UI Description.
      {...props}
    />
  )
}
