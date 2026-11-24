import { Input as InputPrimitive } from '@base-ui/react/input'
import * as React from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line eslint/func-style -- The application React rule requires component declarations.
export function Input({ className, type, ...props }: React.ComponentProps<'input'>): React.JSX.Element {
  return (
    <InputPrimitive
      type={type}
      data-slot='input'
      // oxlint-disable-next-line react/forbid-component-props -- Base UI Input receives its field styling through className.
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Forward the caller’s input value, events and accessibility attributes to the Base UI field.
      {...props}
    />
  )
}
