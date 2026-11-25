import { Array, Predicate } from 'effect'
import type { ReactNode } from 'react'

import { hasSingleItem } from '#contracts/item-count.ts'

/** Structural subset shared by Standard Schema issues and TanStack Form error values. */
export type FormIssue = Readonly<{
  message?: unknown
}>

export interface FormErrorsProps {
  errors?: unknown
  id?: string
  className?: string
  'aria-label'?: string
}

const messagesFrom = function messagesFrom(error: unknown): string[] {
  if (Predicate.isString(error) && error.trim()) {
    return [error]
  }
  if (globalThis.Array.isArray(error)) {
    return error.flatMap((entry) => messagesFrom(entry))
  }
  if (!Predicate.isObjectOrArray(error)) {
    return []
  }
  const issue = error as FormIssue & Readonly<{ errors?: unknown; errorMap?: unknown }>
  if (Predicate.isString(issue.message) && issue.message.trim()) {
    return [issue.message]
  }
  const errorMap =
    issue.errorMap && typeof issue.errorMap === 'object'
      ? Object.values(issue.errorMap).flatMap((entry) => messagesFrom(entry))
      : messagesFrom(issue.errorMap)
  return [messagesFrom(issue.errors), errorMap].flat()
}

/**
 * Renders the message-bearing portion of Standard Schema and TanStack Form errors.
 * Form state and validation remain owned by the calling form.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FormErrors = function FormErrors({
  errors,
  id,
  className,
  'aria-label': ariaLabel = 'Validation errors',
}: FormErrorsProps): ReactNode {
  const messages = [...new Set(messagesFrom(errors))]
  if (Array.isArrayEmpty(messages)) {
    return false
  }
  const classes = ['mt-1 text-xs text-danger-text', className].filter(Boolean).join(' ')
  if (hasSingleItem(messages)) {
    return (
      <p id={id} role='alert' className={classes}>
        {messages[0]}
      </p>
    )
  }
  return (
    <div id={id} role='alert' aria-label={ariaLabel} className={classes}>
      <ul className='m-0 list-disc pl-4'>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  )
}
