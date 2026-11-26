import type { JSX, ReactNode } from 'react'

import { Field as PrimitiveField, FieldLabel, FieldDescription, FieldError } from '@/components/generated/field.tsx'

export interface FieldProps {
  label: ReactNode
  htmlFor: string
  required?: boolean
  help?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  class?: string
  className?: string
  children: ReactNode
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Field = function Field({
  label,
  htmlFor,
  required,
  help,
  hint,
  error,
  class: legacyClass,
  className,
  children,
}: FieldProps): JSX.Element {
  return (
    <PrimitiveField
      data-invalid={Boolean(error) || undefined}
      className={['mb-3', legacyClass, className].filter(Boolean).join(' ')}
    >
      <FieldLabel htmlFor={htmlFor}>
        {label}
        {required && (
          <span aria-hidden='true' className='text-accent'>
            {' '}
            *
          </span>
        )}
      </FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : (help ?? hint) && <FieldDescription>{help ?? hint}</FieldDescription>}
    </PrimitiveField>
  )
}
