'use client'

import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { useMemo } from 'react'

import { Label } from '@/components/generated/label'
import { Separator } from '@/components/generated/separator'
// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldSet = function FieldSet({
  className,
  ...props
}: React.ComponentProps<'fieldset'>): React.JSX.Element {
  return (
    <fieldset
      data-slot='field-set'
      className={cn(
        'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native fieldset attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldLegend = function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }): React.JSX.Element {
  return (
    <legend
      data-slot='field-legend'
      data-variant={variant}
      className={cn('mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native legend attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldGroup = function FieldGroup({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='field-group'
      className={cn(
        'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

const fieldVariants = cva('group/field flex w-full gap-2 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: 'flex-col *:w-full [&>.sr-only]:w-auto',
      horizontal:
        'flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      responsive:
        'flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
})

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Field = function Field({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof fieldVariants>): React.JSX.Element {
  return (
    <div
      role='group'
      data-slot='field'
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldContent = function FieldContent({
  className,
  ...props
}: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='field-content'
      className={cn('group/field-content flex flex-1 flex-col gap-0.5 leading-snug', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldLabel = function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>): React.JSX.Element {
  return (
    <Label
      data-slot='field-label'
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-muted/50 has-[>[data-slot=field]]:has-[:focus-visible]:border-ring has-[>[data-slot=field]]:has-[:focus-visible]:ring-3 has-[>[data-slot=field]]:has-[:focus-visible]:ring-ring/50 *:data-[slot=field]:p-2.5 dark:has-data-checked:border-primary/20 dark:has-data-checked:bg-primary/10',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Forward the caller's element attributes, accessibility props and handlers through Label.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldTitle = function FieldTitle({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot='field-label'
      className={cn(
        'flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldDescription = function FieldDescription({
  className,
  ...props
}: React.ComponentProps<'p'>): React.JSX.Element {
  return (
    <p
      data-slot='field-description'
      className={cn(
        'text-left text-sm leading-normal font-normal text-muted-foreground group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5',
        'last:mt-0 nth-last-2:-mt-1',
        '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
        className,
      )}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native p attributes and events.
      {...props}
    />
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldSeparator = function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      data-slot='field-separator'
      data-content={!!children}
      className={cn('relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    >
      <Separator className='absolute inset-0 top-1/2' />
      {children && (
        <span
          className='relative mx-auto block w-fit bg-background px-2 text-muted-foreground'
          data-slot='field-separator-content'
        >
          {children}
        </span>
      )}
    </div>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FieldError = function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & {
  errors?: ({ message?: string } | undefined)[]
}): React.JSX.Element | null {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [...new Map(errors.map((error) => [error?.message, error])).values()]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className='ml-4 flex list-disc flex-col gap-1'>
        {uniqueErrors.map((error, index) => error?.message && <li key={index}>{error.message}</li>)}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role='alert'
      data-slot='field-error'
      className={cn('text-sm font-normal text-destructive', className)}
      // oxlint-disable-next-line react/jsx-props-no-spreading -- Preserve the caller's native div attributes and events.
      {...props}
    >
      {content}
    </div>
  )
}
