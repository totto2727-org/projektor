import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from 'react'

import { Input as PrimitiveInput } from '@/components/generated/input.tsx'
import { Textarea as PrimitiveTextarea } from '@/components/generated/textarea.tsx'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  class?: string
  inputRef?: Ref<HTMLInputElement>
}
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  class?: string
  inputRef?: Ref<HTMLTextAreaElement>
}
export const Input = function Input({ class: legacyClass, className, inputRef, ...props }: InputProps) {
  return <PrimitiveInput {...props} ref={inputRef} className={[legacyClass, className].filter(Boolean).join(' ')} />
}
export const Textarea = function Textarea({ class: legacyClass, className, inputRef, ...props }: TextareaProps) {
  return <PrimitiveTextarea {...props} ref={inputRef} className={[legacyClass, className].filter(Boolean).join(' ')} />
}
