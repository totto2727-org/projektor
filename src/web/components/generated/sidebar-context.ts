'use client'

import * as React from 'react'

// Context from the shadcn 4.21.1 base-nova Sidebar.
export interface SidebarContextProps {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

export const SidebarContext = React.createContext<SidebarContextProps | undefined>(undefined)

export const useSidebar = function useSidebar(): SidebarContextProps {
  const context = React.useContext(SidebarContext)
  if (!context) {
    // oxlint-disable-next-line rules/require-tagged-error -- Preserve the registry hook's native Error when a caller omits SidebarProvider.
    throw new Error('useSidebar must be used within a SidebarProvider.')
  }

  return context
}
