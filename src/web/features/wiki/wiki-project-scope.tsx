'use client'

import { useCallback, useMemo } from 'react'
import type { JSX } from 'react'

import { Select } from '@/components/ui/select.tsx'
import type { SelectOption } from '@/components/ui/select.tsx'

import { navigateFeature } from './navigation.ts'
import { wikiHref } from './wiki-href.ts'
import { useWikiSeed } from './wiki-seed-context.ts'

const allProjectsOption: SelectOption = { label: 'Workspace (all projects)', value: '' }

// Selecting another project navigates to reload its tree and search results.
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function ScopeControl({ projectId }: { projectId: string }): JSX.Element {
  const { projects, workspaceSlug } = useWikiSeed()
  const options = useMemo(
    () => [
      allProjectsOption,
      ...projects.map((project) => ({ label: `${project.key} — ${project.name}`, value: project.id })),
    ],
    [projects],
  )
  const handleScopeChange = useCallback(
    (value: string): void => {
      navigateFeature(wikiHref({ projectId: value, workspaceSlug }, '/wiki'))
    },
    [workspaceSlug],
  )

  return (
    <div className='mb-3'>
      <p className='m-0 mb-1 text-[0.7rem] text-text-muted'>Scope</p>
      <Select value={projectId} options={options} ariaLabel='Wiki project scope' onChange={handleScopeChange} />
    </div>
  )
}
