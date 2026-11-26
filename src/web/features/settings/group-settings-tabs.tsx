'use client'

import { Predicate } from 'effect'
import { memo, useCallback, useMemo, useRef } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import { nextTabId } from './group-tab-navigation.ts'
import type { Tab } from './group-tab-navigation.ts'

const GROUP_TABS: Readonly<Tab[]> = ['members', 'groups']
const TAB_IN_SEQUENCE = 0
const TAB_OUTSIDE_SEQUENCE = -1

interface GroupSettingsTabsProps {
  activeTab: Tab
  workspaceSlug: string
}

interface GroupTabFocus {
  handleKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => void
  refCallbacks: Record<Tab, (element: HTMLAnchorElement | null) => void>
}

const useGroupTabFocus = function useGroupTabFocus(activeTab: Tab): GroupTabFocus {
  const tabRefs = useRef<Partial<Record<Tab, HTMLAnchorElement | null>>>({})
  const refCallbacks = useMemo(
    () => ({
      groups: (element: HTMLAnchorElement | null): void => {
        tabRefs.current.groups = element
      },
      members: (element: HTMLAnchorElement | null): void => {
        tabRefs.current.members = element
      },
    }),
    [],
  )
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLAnchorElement>): void => {
      const next = nextTabId(GROUP_TABS, activeTab, event.key)
      if (Predicate.isNotNullish(next)) {
        event.preventDefault()
        tabRefs.current[next]?.focus()
      }
    },
    [activeTab],
  )
  return { handleKeyDown, refCallbacks }
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function GroupTabList({ activeTab, workspaceSlug }: GroupSettingsTabsProps): JSX.Element {
  const { handleKeyDown, refCallbacks } = useGroupTabFocus(activeTab)
  return (
    <div role='tablist' aria-label='Groups' className='flex gap-1 border-b border-border mb-4'>
      {GROUP_TABS.map((id) => (
        <a
          key={id}
          ref={refCallbacks[id]}
          href={`/settings/groups?${new URLSearchParams([
            ['workspace', workspaceSlug],
            ['view', id],
          ])}`}
          role='tab'
          onKeyDown={handleKeyDown}
          id={`group-tab-${id}`}
          aria-selected={activeTab === id}
          aria-controls={`group-tabpanel-${id}`}
          tabIndex={activeTab === id ? TAB_IN_SEQUENCE : TAB_OUTSIDE_SEQUENCE}
          className={`px-4 py-2 text-[0.85rem] font-semibold border-b-2 -mb-px bg-transparent cursor-pointer ${activeTab === id ? 'border-accent text-text-base' : 'border-transparent text-text-muted hover:text-text-base'}`}
        >
          {id === 'members' ? 'Members' : 'Groups'}
        </a>
      ))}
    </div>
  )
}

export const GroupSettingsTabs = memo(GroupTabList)
GroupSettingsTabs.displayName = 'GroupSettingsTabs'
