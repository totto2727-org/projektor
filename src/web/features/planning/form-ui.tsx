import { Predicate } from 'effect'
import type { ReactNode } from 'react'

const messages = function messages(value: unknown): string[] {
  if (Predicate.isString(value)) {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap(messages)
  }
  if (value && typeof value === 'object') {
    if ('message' in value && Predicate.isString(value.message)) {
      return [value.message]
    }
    return Object.values(value).flatMap(messages)
  }
  return []
}
/** Display Standard Schema issues without inventing a second validation layer. */
export const FormErrors = function FormErrors({
  errors,
  children,
}: {
  errors: Readonly<unknown[]>
  children?: ReactNode
}) {
  const text = [...new Set(errors.flatMap(messages))]
  return text.length ? (
    <div role='alert' className='text-danger-text text-[0.8rem] mb-3'>
      {text.map((message) => (
        <p key={message} className='m-0'>
          {message}
        </p>
      ))}
      {children}
    </div>
  ) : null
}
