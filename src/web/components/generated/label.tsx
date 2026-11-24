'use client'

import * as React from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line eslint/func-style -- The application React rule requires component declarations.
export function Label({ className, htmlFor, children, ...props }: React.ComponentProps<'label'>): React.JSX.Element {
  return (
    <label
      data-slot='label'
      htmlFor={htmlFor}
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Forward the caller’s native label attributes and events.
      {...props}
    >
      {children}
    </label>
  )
}
