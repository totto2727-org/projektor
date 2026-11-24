'use client'
import { Predicate } from 'effect'
import type { JSX, CSSProperties } from 'react'

import {
  Select as PrimitiveSelect,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/generated/select.tsx'

export interface SelectOption {
  value: string
  label: string
  action?: { ariaLabel: string; icon?: string; onClick: () => void }
}
export interface SelectProps {
  value: string
  options: Readonly<SelectOption[]>
  onChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  buttonStyle?: CSSProperties
  capitalize?: boolean
  buttonClass?: string
  placeholder?: string
  class?: string
  className?: string
}

/** Translate legacy options into Base UI selection. No app-owned dropdown state. */
export function Select({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  buttonStyle,
  capitalize,
  buttonClass,
  placeholder,
  class: legacyClass,
  className,
}: SelectProps): JSX.Element {
  const label = options.find((option) => option.value === value)?.label ?? (value || placeholder || '')
  return (
    <div className={[legacyClass, className].filter(Boolean).join(' ')}>
      <PrimitiveSelect
        value={value}
        disabled={disabled}
        items={options}
        onValueChange={(nextValue) => {
          if (Predicate.isNotNullish(nextValue)) {
            onChange(nextValue)
          }
        }}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          className={buttonClass}
          style={{ textTransform: capitalize === true ? 'capitalize' : undefined, ...buttonStyle }}
        >
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent align='start' alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              label={option.label}
              style={{ textTransform: capitalize === true ? 'capitalize' : undefined }}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </PrimitiveSelect>
    </div>
  )
}
export default Select
