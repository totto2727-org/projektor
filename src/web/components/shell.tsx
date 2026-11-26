'use client'

import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import pkg from '#package-metadata'
import type { BrandConfig } from '@/brand.ts'
import type { RequestScope } from '@/server/request-context.ts'

import { AccountMenu } from './account-menu.tsx'
import type { Prefs, Theme } from './account-menu.tsx'
import { Button } from './generated/button.tsx'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from './generated/popover.tsx'
import { useSidebar } from './generated/sidebar-context.ts'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from './generated/sidebar.tsx'
import { TooltipProvider } from './generated/tooltip.tsx'

export interface ShellProps {
  children: ReactNode
  scope: RequestScope | null
  pathname: string
  returnTo?: string
  brand?: BrandConfig
}

const DEFAULT_PREFS: Prefs = { theme: 'system', density: 'comfortable', sidebar: 'expanded' }
const glossary = {
  groups: {
    label: 'Groups',
    definition: 'Teams of members that share the same project access permissions.',
  },
  tokens: {
    label: 'Tokens',
    definition: 'API keys that let external tools or AI agents act on your behalf.',
  },
} as const

const readPrefs = function readPrefs(): Prefs {
  try {
    const value = JSON.parse(localStorage.getItem('prefs') ?? 'null')
    const legacyTheme = localStorage.getItem('theme')
    return {
      theme:
        value?.theme === 'light' || value?.theme === 'dark' || value?.theme === 'system'
          ? value.theme
          : legacyTheme === 'light' || legacyTheme === 'dark'
            ? legacyTheme
            : 'system',
      density: value?.density === 'compact' ? 'compact' : 'comfortable',
      sidebar: value?.sidebar === 'collapsed' ? 'collapsed' : 'expanded',
    }
  } catch {
    return DEFAULT_PREFS
  }
}

/**
 * Safe-ls: cosmetic theme, density and navigation preferences never reach an API request.
 *
 * @param {Prefs} prefs The theme, density, and sidebar preferences to apply to the document root.
 */
const applyPrefs = function applyPrefs(prefs: Prefs): void {
  const root = document.documentElement
  if (prefs.theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.dataset.theme = prefs.theme
  }
  root.dataset.density = prefs.density
  root.dataset.sidebar = prefs.sidebar
}
const savePrefs = function savePrefs(prefs: Prefs): void {
  try {
    // Safe-ls: cosmetic preferences only, with a graceful default when storage is unavailable.
    localStorage.setItem('prefs', JSON.stringify(prefs))
    localStorage.removeItem('theme')
  } catch {
    /* Cosmetic preference storage is optional. */
  }
}
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const Icon = function Icon({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      {children}
    </svg>
  )
}
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const ThemeIcon = function ThemeIcon({ theme }: { theme: Theme }): JSX.Element {
  return (
    <Icon>
      {theme === 'light' ? (
        <>
          <circle cx='12' cy='12' r='5' />
          <path d='M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42' />
        </>
      ) : theme === 'dark' ? (
        <path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' />
      ) : (
        <>
          <rect x='2' y='3' width='20' height='14' rx='2' />
          <path d='M8 21h8M12 17v4' />
        </>
      )}
    </Icon>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const GlossaryHelp = function GlossaryHelp({ term }: { term: keyof typeof glossary }): JSX.Element {
  const info = glossary[term]
  return (
    <Popover>
      <PopoverTrigger render={<SidebarMenuAction aria-label={`About ${info.label}`} />}>
        <span aria-hidden='true'>ⓘ</span>
      </PopoverTrigger>
      <PopoverContent side='right' align='start' sideOffset={8} className='w-64'>
        <PopoverTitle>{info.label}</PopoverTitle>
        <PopoverDescription>{info.definition}</PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const OfflineBanner = function OfflineBanner(): null | JSX.Element {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = (): void => {
      setOnline(navigator.onLine)
    }
    update()
    addEventListener('online', update)
    addEventListener('offline', update)
    return () => {
      removeEventListener('online', update)
      removeEventListener('offline', update)
    }
  }, [])
  return online ? null : (
    <div role='status' className='offline-banner'>
      You're offline. Changes won't save until your connection returns.
    </div>
  )
}

const nav = [
  {
    href: '/',
    label: 'Projects',
    icon: (
      <>
        <rect x='3' y='3' width='7' height='7' />
        <rect x='14' y='3' width='7' height='7' />
        <rect x='14' y='14' width='7' height='7' />
        <rect x='3' y='14' width='7' height='7' />
      </>
    ),
  },
  {
    href: '/issues',
    label: 'Issues',
    icon: (
      <>
        <rect x='4' y='3' width='16' height='18' rx='2' />
        <path d='M8 8h8M8 12h8M8 16h5' />
      </>
    ),
  },
  {
    href: '/my-issues',
    label: 'My Issues',
    icon: (
      <>
        <circle cx='12' cy='8' r='4' />
        <path d='M4 20c0-4 3.6-7 8-7s8 3 8 7' />
      </>
    ),
  },
  {
    href: '/settings/groups',
    label: 'Groups',
    glossary: 'groups',
    icon: (
      <>
        <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
        <circle cx='9' cy='7' r='4' />
        <path d='M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' />
      </>
    ),
  },
  {
    href: '/settings/tokens',
    label: 'Connect Agent',
    glossary: 'tokens',
    icon: (
      <>
        <rect x='3' y='11' width='18' height='11' rx='2' />
        <path d='M7 11V7a5 5 0 0 1 10 0v4' />
      </>
    ),
  },
] as const

function workspaceHref(path: string, scope: RequestScope | null): string {
  const selection = scope?.selection
  if (selection?.kind !== 'workspace' && selection?.kind !== 'project') {
    return path
  }
  return `${path}?${new URLSearchParams({ workspace: selection.workspace.slug })}`
}

const renderSidebarHelpButton = (): JSX.Element => (
  <Button
    variant='ghost'
    size='icon-sm'
    render={<a href='/help' />}
    nativeButton={false}
    aria-label='Help, glossary of terms'
    title='Help'
  >
    <Icon>
      <circle cx='12' cy='12' r='10' />
      <path d='M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01' />
    </Icon>
  </Button>
)

const renderSidebarControls = (prefs: Prefs, cycleTheme: () => void): JSX.Element => (
  <div className='flex flex-wrap gap-1 group-data-[collapsible=icon]:flex-col'>
    {renderSidebarHelpButton()}
    <Button variant='ghost' size='icon-sm' aria-label={`Theme: ${prefs.theme}, switch theme`} onClick={cycleTheme}>
      <ThemeIcon theme={prefs.theme} />
    </Button>
    <SidebarTrigger />
  </div>
)

const renderSidebarFooter = (prefs: Prefs, cycleTheme: () => void): JSX.Element => (
  <SidebarFooter>
    {renderSidebarControls(prefs, cycleTheme)}
    <span className='px-2 text-[0.6875rem] text-muted-foreground group-data-[collapsible=icon]:hidden'>
      v{pkg.version}
    </span>
  </SidebarFooter>
)

const renderPrimaryNavigation = (
  pathname: string,
  scope: RequestScope | null,
  setOpenMobile: (open: boolean) => void,
): JSX.Element => {
  const renderNavigationMenu = (): JSX.Element => (
    <SidebarMenu aria-label='Primary navigation'>
      {nav.map((item) => {
        const active =
          item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`)
        const renderNavigationButton = (): JSX.Element => (
          <SidebarMenuButton
            isActive={active}
            tooltip={item.label}
            render={
              <a
                href={workspaceHref(item.href, scope)}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setOpenMobile(false)
                }}
              />
            }
          >
            <Icon>{item.icon}</Icon>
            <span>{item.label}</span>
          </SidebarMenuButton>
        )

        return (
          <SidebarMenuItem key={item.href}>
            {renderNavigationButton()}
            {'glossary' in item && <GlossaryHelp term={item.glossary} />}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>{renderNavigationMenu()}</SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  )
}

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
function ShellContent({
  children,
  scope,
  pathname,
  returnTo,
  brand,
  prefs,
  update,
}: ShellProps & { prefs: Prefs; update: (patch: Partial<Prefs>) => void }): JSX.Element {
  const { isMobile, setOpenMobile } = useSidebar()
  const brandName = brand?.name ?? 'Projektor'
  const brandMark = brand?.mark ?? 'P'
  const projectsHref = workspaceHref('/', scope)
  const fullBleed = pathname === '/wiki' || pathname.startsWith('/wiki/')
  const cycleTheme = function cycleTheme(): void {
    const order: Theme[] = ['system', 'light', 'dark']
    update({ theme: order[(order.indexOf(prefs.theme) + 1) % order.length] })
  }
  const renderTopbarBrand = (): JSX.Element => (
    <div className='flex min-w-0 items-center gap-2'>
      {/* CSS shows the trigger before the provider detects the mobile viewport. */}
      <SidebarTrigger className='md:hidden' disabled={!isMobile} />
      <a href={projectsHref} className='topbar-brand min-w-0'>
        <span className='brand-mark'>{brandMark}</span>
        <span className='truncate'>{brandName}</span>
      </a>
    </div>
  )

  const renderMobileBrand = (): JSX.Element => (
    <a
      href={projectsHref}
      className='topbar-brand'
      onClick={() => {
        setOpenMobile(false)
      }}
    >
      <span className='brand-mark'>{brandMark}</span>
      <span>{brandName}</span>
    </a>
  )

  return (
    <>
      <header className='projektor-topbar'>
        {renderTopbarBrand()}
        <AccountMenu scope={scope} returnTo={returnTo ?? '/'} prefs={prefs} update={update} />
      </header>
      <Sidebar collapsible='icon' className='border-border pt-[var(--topbar-height)]'>
        <SidebarHeader className='md:hidden'>{renderMobileBrand()}</SidebarHeader>
        {renderPrimaryNavigation(pathname, scope, setOpenMobile)}
        <SidebarSeparator />
        {renderSidebarFooter(prefs, cycleTheme)}
      </Sidebar>
      <SidebarInset id='main-content' tabIndex={-1} className='min-w-0 pt-[var(--topbar-height)]'>
        <div className='projektor-page-content' data-full-bleed={fullBleed || undefined}>
          {children}
        </div>
      </SidebarInset>
    </>
  )
}

/**
 * Request-local scope stays in props. Generated Base UI owns drawer, menu positioning and sidebar controls.
 *
 * @param {ShellProps} props The page content, request scope, and navigation data for the surrounding layout.
 * @returns {JSX.Element} The page shell with its sidebar, navigation, and main content.
 */
// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function Shell(props: ShellProps): JSX.Element {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS)
  useEffect(() => {
    const next = readPrefs()
    setPrefs(next)
    applyPrefs(next)
  }, [])
  const update = function update(patch: Partial<Prefs>): void {
    const next = { ...readPrefs(), ...patch }
    savePrefs(next)
    applyPrefs(next)
    setPrefs(next)
  }
  const renderShellContent = (): JSX.Element => <ShellContent {...props} prefs={prefs} update={update} />

  return (
    <>
      <a className='skip-link' href='#main-content'>
        Skip to content
      </a>
      <OfflineBanner />
      <TooltipProvider>
        <SidebarProvider
          open={prefs.sidebar === 'expanded'}
          onOpenChange={(open) => update({ sidebar: open ? 'expanded' : 'collapsed' })}
        >
          {renderShellContent()}
        </SidebarProvider>
      </TooltipProvider>
    </>
  )
}
