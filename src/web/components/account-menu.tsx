'use client'

import { useId } from 'react'
import type { JSX } from 'react'

import type { RequestScope } from '@/server/request-context.ts'

import { Avatar, AvatarFallback } from './generated/avatar.tsx'
import { Button } from './generated/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './generated/dropdown-menu.tsx'
import { useSidebar } from './generated/sidebar-context.ts'

export type Theme = 'system' | 'light' | 'dark'
type Density = 'comfortable' | 'compact'
type SidebarPreference = 'expanded' | 'collapsed'
export type Prefs = { theme: Theme; density: Density; sidebar: SidebarPreference }

const initials = function initials(name: string, email: string): string {
  const words = (name.trim() || email).split(/\s+/u).filter(Boolean)
  return words.length > 1 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : (words[0] ?? '?').slice(0, 2).toUpperCase()
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
const Preferences = function Preferences({
  prefs,
  update,
}: {
  prefs: Prefs
  update: (patch: Partial<Prefs>) => void
}): JSX.Element {
  const { open, setOpen } = useSidebar()
  const renderDensityPreference = (): JSX.Element => (
    <DropdownMenuRadioGroup
      value={prefs.density}
      onValueChange={(value) => update({ density: value === 'compact' ? 'compact' : 'comfortable' })}
    >
      <DropdownMenuRadioItem value='comfortable'>Comfortable</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value='compact'>Compact</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  )

  const renderSidebarPreference = (): JSX.Element => (
    <DropdownMenuRadioGroup
      value={open ? 'expanded' : 'collapsed'}
      onValueChange={(value) => setOpen(value !== 'collapsed')}
    >
      <DropdownMenuRadioItem value='expanded'>Expanded</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value='collapsed'>Collapsed</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  )

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Density</DropdownMenuLabel>
        {renderDensityPreference()}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Sidebar</DropdownMenuLabel>
        {renderSidebarPreference()}
      </DropdownMenuGroup>
    </>
  )
}

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const AccountMenu = function AccountMenu({
  scope,
  returnTo,
  prefs,
  update,
}: {
  scope: RequestScope | null
  returnTo: string
  prefs: Prefs
  update: (patch: Partial<Prefs>) => void
}): JSX.Element {
  const refreshId = useId()
  const logoutId = useId()
  const user = scope?.user
  if (!user) {
    return (
      <form method='post' action='/auth/session'>
        <input type='hidden' name='action' value='login' />
        <input type='hidden' name='redirect_url' value={returnTo} />
        <Button type='submit' variant='ghost'>
          Log in
        </Button>
      </form>
    )
  }
  const renderAccountTrigger = (): JSX.Element => (
    <DropdownMenuTrigger
      render={
        <Button variant='ghost' aria-label={`Account: ${user.name || user.email}`} className='max-w-full gap-2' />
      }
    >
      <Avatar className='size-7'>
        <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
      </Avatar>
      <span className='hidden max-w-48 truncate sm:inline'>{user.name || user.email}</span>
      <span aria-hidden='true'>▾</span>
    </DropdownMenuTrigger>
  )

  const renderAccountLabel = (): JSX.Element => (
    <DropdownMenuGroup>
      <DropdownMenuLabel>
        <span className='block truncate font-semibold'>{user.name}</span>
        <span className='block truncate font-normal'>{user.email}</span>
      </DropdownMenuLabel>
    </DropdownMenuGroup>
  )

  const renderAccountItems = (): JSX.Element => (
    <DropdownMenuContent align='end' sideOffset={8} className='w-60'>
      {renderAccountLabel()}
      <DropdownMenuSeparator />
      <DropdownMenuItem nativeButton render={<button type='submit' form={refreshId} />}>
        Refresh session
      </DropdownMenuItem>
      <DropdownMenuItem nativeButton render={<button type='submit' form={logoutId} />}>
        Log out
      </DropdownMenuItem>
      <Preferences prefs={prefs} update={update} />
    </DropdownMenuContent>
  )

  return (
    <>
      {/* Keep native auth forms outside the portalled menu so closing it cannot discard the form. */}
      <form hidden id={refreshId} method='post' action='/auth/session'>
        <input type='hidden' name='action' value='login' />
        <input type='hidden' name='redirect_url' value={returnTo} />
      </form>
      <form hidden id={logoutId} method='post' action='/auth/session'>
        <input type='hidden' name='action' value='logout' />
      </form>
      <DropdownMenu>
        {renderAccountTrigger()}
        {renderAccountItems()}
      </DropdownMenu>
    </>
  )
}
