'use client'
/**
 * Follow an ordinary anchor so Effront, not a parallel history router, owns navigation.
 *
 * @param {string} href The issue route for the temporary anchor.
 */
export const navigateIssues = function navigateIssues(href: string): void {
  const link = document.createElement('a')
  link.href = href
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
}
