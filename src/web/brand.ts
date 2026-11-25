import { Effect, Schema } from 'effect'
import type { CSSProperties } from 'react'

import { firstCodePoint, isNonEmptyText, trimNonEmptyText } from '#contracts/non-empty-text.ts'
import { WorkspaceBrand } from '#contracts/web-brand.ts'
import { makeCoreClient } from '#core/client.ts'

import { browserRequest, coreResult } from './core.ts'
import type { Env } from './request.ts'
import type { RequestScope } from './server/server-context.ts'

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

export const deploymentBrand = function deploymentBrand(env: BrandEnvironment): BrandConfig {
  const name = trimNonEmptyText(env.BRAND_NAME) ?? defaultBrand.name
  return {
    name,
    mark: env.BRAND_MARK?.trim()
      ? (firstCodePoint(env.BRAND_MARK.trim()) ?? 'P')
      : (firstCodePoint(name.trim())?.toUpperCase() ?? 'P'),
    accent: trimNonEmptyText(env.BRAND_ACCENT) ?? null,
    onAccent: trimNonEmptyText(env.BRAND_ON_ACCENT) ?? null,
    logoUrl: trimNonEmptyText(env.BRAND_LOGO_URL) ?? null,
  }
}

/**
 * Cosmetic failures do not turn otherwise valid project data into an error page.
 *
 * @param {Env} env The deployment defaults and Core binding.
 * @param {RequestScope | null} scope The workspace or project selection, when available.
 * @param {Request} [request] The incoming request used for the Core read.
 * @returns {Effect.Effect<BrandConfig>} An effect that resolves the brand using deployment defaults and any available workspace overrides.
 */
export const loadBrand = function loadBrand(
  env: Env,
  scope: RequestScope | null,
  request?: Request,
): Effect.Effect<BrandConfig> {
  const brand = deploymentBrand(env)
  if (scope?.selection.kind !== 'workspace' && scope?.selection.kind !== 'project') {
    return Effect.succeed(brand)
  }
  const { workspace } = scope.selection
  if (!scope.workspaces.some((member) => member.id === workspace.id && member.slug === workspace.slug)) {
    return Effect.succeed(brand)
  }
  if (!request) {
    return Effect.succeed(brand)
  }
  return coreResult(
    WorkspaceBrand,
    makeCoreClient(env.CORE).browserWorkspaceBrand(browserRequest(request), workspace.slug),
  ).pipe(
    Effect.map((override) => {
      const name = override.displayName ?? brand.name
      return {
        name,
        mark: isNonEmptyText(override.displayName)
          ? (firstCodePoint(name.trim())?.toUpperCase() ?? brand.mark)
          : brand.mark,
        accent: override.accent ?? brand.accent,
        onAccent: override.onAccent ?? brand.onAccent,
        logoUrl: override.logoUrl ?? brand.logoUrl,
      }
    }),
    Effect.catch(() => Effect.succeed(brand)),
  )
}

/**
 * Emit preferences before paint without a client-side, cross-workspace brand cache.
 *
 * @param {BrandConfig} brand The resolved brand preferences.
 * @returns {CSSProperties} The configured CSS custom properties for theme colors.
 */
export const brandStyles = function brandStyles(brand: BrandConfig): CSSProperties {
  const styles: CSSProperties & Record<string, string> = {}
  if (isNonEmptyText(brand.accent)) {
    styles['--light-accent'] = brand.accent
    styles['--dark-accent'] = brand.accent
  }
  if (isNonEmptyText(brand.onAccent)) {
    styles['--light-on-accent'] = brand.onAccent
    styles['--dark-on-accent'] = brand.onAccent
  }
  return styles
}
