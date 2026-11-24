// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

// oxlint-disable-next-line eslint/func-style -- The application React rule requires component declarations.
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading -- Forward caller DOM attributes and events to the skeleton.
  return <div data-slot='skeleton' className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}
