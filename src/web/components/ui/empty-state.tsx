import type { JSX, ReactNode } from 'react'

import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from '@/components/generated/empty.tsx'

export interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  class?: string
  className?: string
}
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const EmptyState = function EmptyState({
  title,
  description,
  action,
  icon,
  class: legacyClass,
  className,
}: EmptyStateProps): JSX.Element {
  return (
    <Empty className={['py-12', legacyClass, className].filter(Boolean).join(' ')}>
      <EmptyHeader>
        {icon && <EmptyMedia>{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}
