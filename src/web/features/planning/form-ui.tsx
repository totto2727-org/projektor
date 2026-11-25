import { Predicate } from 'effect'
import type { JSX, ReactNode } from 'react'

const messages = function messages(value: unknown): string[] {
  if (Predicate.isString(value)) {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => messages(entry))
  }
  if (Predicate.isObjectOrArray(value)) {
    if ('message' in value && Predicate.isString(value.message)) {
      return [value.message]
    }
    return Object.values(value).flatMap((entry) => messages(entry))
  }
  return []
}
/** Display Standard Schema issues without inventing a second validation layer. */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const FormErrors = function FormErrors({
  errors,
  children,
}: {
  errors: Readonly<unknown[]>
  children?: ReactNode
}): null | JSX.Element {
  const text = [...new Set(errors.flatMap((entry) => messages(entry)))]
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
