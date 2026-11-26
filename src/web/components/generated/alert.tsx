import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import * as React from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Alert = function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
  return <div data-slot='alert' role='alert' className={cn(alertVariants({ variant }), className)} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const AlertTitle = function AlertTitle({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='alert-title'
      className={cn(
        'font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const AlertDescription = function AlertDescription({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='alert-description'
      className={cn(
        'text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const AlertAction = function AlertAction({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
  return <div data-slot='alert-action' className={cn('absolute top-2 right-2', className)} {...props} />
}
