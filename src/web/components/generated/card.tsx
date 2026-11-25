import * as React from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Card = function Card({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm' }): React.JSX.Element {
  return (
    <div
      data-slot='card'
      data-size={size}
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const CardHeader = function CardHeader({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='card-header'
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const CardTitle = function CardTitle({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='card-title'
      className={cn('font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const CardDescription = function CardDescription({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
  return <div data-slot='card-description' className={cn('text-sm text-muted-foreground', className)} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const CardAction = function CardAction({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='card-action'
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const CardContent = function CardContent({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
  return <div data-slot='card-content' className={cn('px-(--card-spacing)', className)} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const CardFooter = function CardFooter({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='card-footer'
      className={cn('flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}
