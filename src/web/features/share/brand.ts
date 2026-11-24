import { Schema } from 'effect'

import { isNonEmptyText } from '#contracts/non-empty-text.ts'

const nullable = Schema.NullOr(Schema.String)
export const WorkspaceBrand = Schema.Struct({
  displayName: nullable,
  accent: nullable,
  onAccent: nullable,
  fontFamily: nullable,
  fontUrl: nullable,
  logoUrl: nullable,
})
export type WorkspaceBrandDto = typeof WorkspaceBrand.Type
export const DeploymentBrand = Schema.Struct({
  name: Schema.String,
  mark: Schema.String,
  accent: nullable,
  onAccent: nullable,
  logoUrl: nullable,
})
export type DeploymentBrandDto = typeof DeploymentBrand.Type
export const DEFAULT_BRAND: DeploymentBrandDto = {
  name: 'Projektor',
  mark: 'P',
  accent: null,
  onAccent: null,
  logoUrl: null,
}

export const layerBrand = function layerBrand(base: DeploymentBrandDto, workspace: WorkspaceBrandDto) {
  return {
    name: workspace.displayName ?? base.name,
    mark: isNonEmptyText(workspace.displayName)
      ? (Array.from(workspace.displayName.trim())[0]?.toUpperCase() ?? base.mark)
      : base.mark,
    accent: workspace.accent ?? base.accent,
    onAccent: workspace.onAccent ?? base.onAccent,
    logoUrl: workspace.logoUrl ?? base.logoUrl,
    fontFamily: workspace.fontFamily,
    fontUrl: workspace.fontUrl,
  }
}
