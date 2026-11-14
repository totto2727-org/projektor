import { Effect, Schema } from 'effect'
import type { CSSProperties } from 'react'

import { WorkspaceBrand } from '../contracts/web-brand'
import { makeCoreClient } from '../core/client'
import { browserRequest, coreResult } from './core'
import type { Env } from './request'
import type { RequestScope } from './server'

const DeploymentBrand = Schema.Struct({
  name: Schema.String,
  mark: Schema.String,
  accent: Schema.NullOr(Schema.String),
  onAccent: Schema.NullOr(Schema.String),
  logoUrl: Schema.NullOr(Schema.String),
})
export type BrandConfig = Schema.Schema.Type<typeof DeploymentBrand>
export const defaultBrand: BrandConfig = { name: 'Projektor', mark: 'P', accent: null, onAccent: null, logoUrl: null }
type BrandEnvironment = Pick<Env, 'BRAND_NAME' | 'BRAND_MARK' | 'BRAND_ACCENT' | 'BRAND_ON_ACCENT' | 'BRAND_LOGO_URL'>

export function deploymentBrand(env: BrandEnvironment): BrandConfig {
  const name = env.BRAND_NAME?.trim() || defaultBrand.name
  return {
    name,
    mark: env.BRAND_MARK?.trim()
      ? (Array.from(env.BRAND_MARK.trim())[0] ?? 'P')
      : (Array.from(name.trim())[0]?.toUpperCase() ?? 'P'),
    accent: env.BRAND_ACCENT?.trim() || null,
    onAccent: env.BRAND_ON_ACCENT?.trim() || null,
    logoUrl: env.BRAND_LOGO_URL?.trim() || null,
  }
}

/** Cosmetic failures do not turn otherwise valid project data into an error page. */
export function loadBrand(env: Env, scope: RequestScope | null, request?: Request): Effect.Effect<BrandConfig> {
  const brand = deploymentBrand(env)
  if (scope?.selection.kind !== 'workspace' && scope?.selection.kind !== 'project') return Effect.succeed(brand)
  const workspace = scope.selection.workspace
  if (!scope.workspaces.some((member) => member.id === workspace.id && member.slug === workspace.slug))
    return Effect.succeed(brand)
  if (!request) return Effect.succeed(brand)
  return coreResult(
    WorkspaceBrand,
    makeCoreClient(env.CORE).browserWorkspaceBrand(browserRequest(request), workspace.slug),
  ).pipe(
    Effect.map((override) => {
      const name = override.displayName ?? brand.name
      return {
        name,
        mark: override.displayName ? (Array.from(name.trim())[0]?.toUpperCase() ?? brand.mark) : brand.mark,
        accent: override.accent ?? brand.accent,
        onAccent: override.onAccent ?? brand.onAccent,
        logoUrl: override.logoUrl ?? brand.logoUrl,
      }
    }),
    Effect.catch(() => Effect.succeed(brand)),
  )
}

/** Emit preferences before paint without a client-side, cross-workspace brand cache. */
export function brandStyles(brand: BrandConfig): CSSProperties {
  const styles: CSSProperties & Record<string, string> = {}
  if (brand.accent) {
    styles['--light-accent'] = brand.accent
    styles['--dark-accent'] = brand.accent
  }
  if (brand.onAccent) {
    styles['--light-on-accent'] = brand.onAccent
    styles['--dark-on-accent'] = brand.onAccent
  }
  return styles
}
