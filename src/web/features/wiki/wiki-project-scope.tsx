'use client'

import type { JSX } from 'react'

import { Select } from '@/components/ui/select.tsx'
import type { SelectOption } from '@/components/ui/select.tsx'

import { navigateFeature } from './navigation.ts'
import { wikiHref } from './wiki-href.ts'
import type { ProjectOption } from './wiki-page-model.ts'
import { useWikiSeed } from './wiki-seed-context.ts'

/*
 * Lets a user viewing the workspace-wide wiki (or one project's wiki) switch to another
 * scope explicitly, since the only other entry point is a project's nav tab. Switching
 * scope is a full navigation (fresh tree/search for the new scope), not an in-place swap.
 */
function useProjects(_workspaceSlug: string | undefined): ProjectOption[] {
  return useWikiSeed().projects
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function ScopeControl({
  workspaceSlug,
  projectId,
}: {
  workspaceSlug: string | undefined
  projectId: string
}): JSX.Element {
  const seed = useWikiSeed()
  const projects = useProjects(workspaceSlug)
  const options: SelectOption[] = [
    { value: '', label: 'Workspace (all projects)' },
    ...projects.map((project) => ({ value: project.id, label: `${project.key} — ${project.name}` })),
  ]

  return (
    <div className='mb-3'>
      <p className='m-0 mb-1 text-[0.7rem] text-text-muted'>Scope</p>
      <Select
        value={projectId}
        options={options}
        ariaLabel='Wiki project scope'
        onChange={(value) => {
          navigateFeature(wikiHref({ ...seed, projectId: value }, '/wiki'))
        }}
      />
    </div>
  )
}
