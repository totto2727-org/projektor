'use client'
import MyIssues from '@/features/issues/components/MyIssues.tsx'
import type { Issue } from '@/features/issues/types.ts'
import type { RequestScope, WorkspaceMembership } from '@/server/request-context.ts'
export type ScopedIssue = Issue & { readonly workspaceSlug: string }
export interface MyIssuesInitialData {
  readonly issues: Readonly<ScopedIssue[]>
  readonly memberships: Readonly<WorkspaceMembership[]>
}
export function MyIssuesPage({ initialData }: { scope: RequestScope; initialData: MyIssuesInitialData }) {
  return (
    <section>
      <h1 className='text-2xl font-bold mb-6'>My Issues</h1>
      <MyIssues initialData={initialData} />
    </section>
  )
}
