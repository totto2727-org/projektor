export type Tab = 'groups' | 'members'

export const nextTabId = function nextTabId(tabs: Readonly<Tab[]>, active: Tab, key: string): Tab | null {
  const index = tabs.indexOf(active)
  if (key === 'ArrowRight') {
    return tabs[(index + 1) % tabs.length]
  }
  if (key === 'ArrowLeft') {
    return tabs[(index - 1 + tabs.length) % tabs.length]
  }
  if (key === 'Home') {
    return tabs[0]
  }
  if (key === 'End') {
    return tabs[tabs.length - 1]
  }
  return null
}
