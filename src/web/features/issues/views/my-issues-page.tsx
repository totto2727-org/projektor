'use client'
import type { JSX } from 'react'

import { MyIssues } from '@/features/issues/components/my-issues.tsx'
import type { Issue } from '@/features/issues/types.ts'
import type { RequestScope, WorkspaceMembership } from '@/server/request-context.ts'
export type ScopedIssue = Issue & { readonly workspaceSlug: string }
export type MyIssuesInitialData = Readonly<{
  issues: Readonly<ScopedIssue[]>
  memberships: Readonly<WorkspaceMembership[]>
}>
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const MyIssuesPage = function MyIssuesPage({
  initialData,
}: {
  scope: RequestScope
  initialData: MyIssuesInitialData
}): JSX.Element {
  return (
    <section>
      <h1 className='text-2xl font-bold mb-6'>My Issues</h1>
      <MyIssues initialData={initialData} />
    </section>
  )
}
