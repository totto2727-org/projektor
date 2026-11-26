'use client'

import type { JSX, CSSProperties, ReactNode } from 'react'

import { Badge as PrimitiveBadge } from '@/components/generated/badge.tsx'

export interface BadgeProps {
  class?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}
/**
 * Priority and status colour remain caller-supplied through style.
 *
 * @param {BadgeProps} props The badge content, classes, and optional inline color.
 * @returns {JSX.Element} The outlined Base UI badge.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Badge = function Badge({ class: legacyClass, className, style, children }: BadgeProps): JSX.Element {
  return (
    <PrimitiveBadge
      variant='outline'
      className={['badge', legacyClass, className].filter(Boolean).join(' ')}
      style={style}
    >
      {children}
    </PrimitiveBadge>
  )
}
