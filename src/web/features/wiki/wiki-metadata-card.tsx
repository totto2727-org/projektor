'use client'

import { Array } from 'effect'
import type { JSX } from 'react'

import { WikiMetadataBadges } from './wiki-metadata-badges.tsx'
import type { WikiPageData } from './wiki-page-client.tsx'
import { WikiVerifyControls } from './wiki-verify-controls.tsx'

// oxlint-disable-next-line eslint/func-style -- The React component-definition rule requires a function declaration.
export function WikiMetadataCard({
  page,
  onVerify,
  verifying,
  verifyError,
  isPublicViewer,
}: {
  page: WikiPageData
  onVerify: () => void
  verifying: boolean
  verifyError: string | undefined
  isPublicViewer: boolean
}): undefined | JSX.Element {
  const hasMetadata =
    Boolean(page.type) ||
    Boolean(page.status) ||
    Array.isArrayNonEmpty(page.tags) ||
    Array.isArrayNonEmpty(page.owners) ||
    Boolean(page.verified_at)
  const hasVerificationSignal = Boolean(page.verify_interval) || Boolean(page.status)
  if (!hasMetadata && !hasVerificationSignal) {
    return undefined
  }

  return (
    <div
      className={
        'flex flex-wrap items-center gap-2 mb-4 p-3 border border-border rounded-lg ' +
        'bg-surface text-[0.8rem] text-text-muted'
      }
    >
      <WikiMetadataBadges page={page} />
      <WikiVerifyControls
        hasVerificationSignal={hasVerificationSignal}
        onVerify={onVerify}
        verifying={verifying}
        verifyError={verifyError}
        isPublicViewer={isPublicViewer}
      />
    </div>
  )
}
