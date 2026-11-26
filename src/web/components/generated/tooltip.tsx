'use client'

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import type * as React from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TooltipProvider = function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve caller attributes and event handlers on the Base UI Provider.
  return <TooltipPrimitive.Provider data-slot='tooltip-provider' delay={delay} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Tooltip = function Tooltip({ ...props }: TooltipPrimitive.Root.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve controlled state, lifecycle callbacks and children on the Base UI Root.
  return <TooltipPrimitive.Root data-slot='tooltip' {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TooltipTrigger = function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's render, event and accessibility props on the Base UI Trigger.
  return <TooltipPrimitive.Trigger data-slot='tooltip-trigger' {...props} />
}

const renderTooltipArrow = (): React.JSX.Element => (
  // oxlint-disable-next-line react/forbid-component-props -- Base UI Tooltip Arrow applies these classes to its own rendered element.
  <TooltipPrimitive.Arrow className='z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5' />
)

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TooltipContent = function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>): React.JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        // oxlint-disable-next-line react/forbid-component-props -- Base UI Tooltip Positioner applies these classes to its own rendered element.
        className='isolate z-50'
      >
        <TooltipPrimitive.Popup
          data-slot='tooltip-content'
          // oxlint-disable-next-line react/forbid-component-props -- Base UI Tooltip Popup applies these classes to its own rendered element.
          className={cn(
            'z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's focus, event and accessibility props on the Base UI Popup.
          {...props}
        >
          {children}
          {renderTooltipArrow()}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}
