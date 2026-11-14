'use client'
/** Follow an ordinary anchor so Effront, not a parallel history router, owns navigation. */
export function navigateIssues(href: string): void {
  const link = document.createElement('a')
  link.href = href
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
}
