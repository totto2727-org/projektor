'use client'

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { CheckIcon } from 'lucide-react'
import type { JSX } from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line eslint/func-style -- The application React rule requires component declarations.
export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props): JSX.Element {
  return (
    <CheckboxPrimitive.Root
      data-slot='checkbox'
      // oxlint-disable-next-line react/forbid-component-props -- Base UI receives the registry styling through className.
      className={cn(
        'peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Forward the caller’s controlled state, attributes, and events to the Base UI checkbox.
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot='checkbox-indicator'
        // oxlint-disable-next-line react/forbid-component-props -- Base UI styles the checkbox indicator through className.
        className='grid place-content-center text-current transition-none [&>svg]:size-3.5'
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
