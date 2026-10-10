'use client'

import type { CSSProperties, ReactNode } from 'react'

import { Badge as PrimitiveBadge } from '../generated/badge'

export interface BadgeProps {
  class?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}
/** Priority and status colour remain caller-supplied through style. */
export function Badge({ class: legacyClass, className, style, children }: BadgeProps) {
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
