# Independent SSR frontend. The existing API/legacy frontend tasks are unchanged.
default:
    @just --list

ssr-install:
    corepack pnpm install --frozen-lockfile

ssr-dev:
    corepack pnpm --filter @projektor/ssr exec vp dev

ssr-build:
    corepack pnpm --filter @projektor/ssr exec vp build

# Use the built RSC + nested SSR Worker, not a substituted test renderer.
ssr-preview:
    corepack pnpm --filter @projektor/ssr exec wrangler dev --config dist/rsc/wrangler.json --local --port 8793

ssr-lint:
    corepack pnpm exec biome check apps/ssr/src apps/ssr/*.ts apps/ssr/*.json apps/ssr/*.jsonc

ssr-format:
    corepack pnpm exec biome check --write apps/ssr/src apps/ssr/*.ts apps/ssr/*.json apps/ssr/*.jsonc

ssr-check: ssr-lint
    corepack pnpm --filter @projektor/ssr exec tsc --noEmit
    corepack pnpm --filter @projektor/ssr exec vitest run --config vitest.config.ts

# Upload is always an explicit operator action, never a build side effect.
ssr-deploy-dry-run: ssr-build
    corepack pnpm --filter @projektor/ssr exec wrangler deploy --config dist/rsc/wrangler.json --dry-run
