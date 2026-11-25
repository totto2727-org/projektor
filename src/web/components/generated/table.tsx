'use client'

import * as React from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Table = function Table({ className, ...props }: React.ComponentProps<'table'>): React.JSX.Element {
  return (
    <div data-slot='table-container' className='relative w-full overflow-x-auto'>
      <table
        data-slot='table'
        className={cn('w-full caption-bottom text-sm', className)}
        // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native table attributes and events.
        {...props}
      />
    </div>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TableHeader = function TableHeader({
  className,
  ...props
}: React.ComponentProps<'thead'>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native thead attributes and events.
  return <thead data-slot='table-header' className={cn('[&_tr]:border-b', className)} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TableBody = function TableBody({ className, ...props }: React.ComponentProps<'tbody'>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native tbody attributes and events.
  return <tbody data-slot='table-body' className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TableFooter = function TableFooter({
  className,
  ...props
}: React.ComponentProps<'tfoot'>): React.JSX.Element {
  return (
    <tfoot
      data-slot='table-footer'
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native tfoot attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TableRow = function TableRow({ className, ...props }: React.ComponentProps<'tr'>): React.JSX.Element {
  return (
    <tr
      data-slot='table-row'
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native tr attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TableHead = function TableHead({ className, ...props }: React.ComponentProps<'th'>): React.JSX.Element {
  return (
    <th
      data-slot='table-head'
      className={cn(
        'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native th attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TableCell = function TableCell({ className, ...props }: React.ComponentProps<'td'>): React.JSX.Element {
  return (
    <td
      data-slot='table-cell'
      className={cn('p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native td attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const TableCaption = function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>): React.JSX.Element {
  return (
    // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native caption attributes and events.
    <caption data-slot='table-caption' className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  )
}
