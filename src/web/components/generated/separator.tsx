'use client'

import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import type { JSX } from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line eslint/func-style -- The application React rule requires component declarations.
export function Separator({ className, orientation = 'horizontal', ...props }: SeparatorPrimitive.Props): JSX.Element {
  return (
    <SeparatorPrimitive
      data-slot='separator'
      orientation={orientation}
      // oxlint-disable-next-line react/forbid-component-props -- Base UI receives the registry styling through className.
      className={cn(
        'shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Forward the caller’s native separator accessibility attributes and events.
      {...props}
    />
  )
}
