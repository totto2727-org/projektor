default:
    @just --list

install:
    vp install --frozen-lockfile

# One stack owns both Workers and the local bindings.
dev:
    vp exec alchemy dev --config alchemy.run.ts

# A resource comparison, not a production build or upload.
plan:
    vp exec alchemy plan --config alchemy.run.ts --stage production

# Intentional operator action. Requires the existing production JWT secret.
deploy:
    vp exec alchemy deploy --config alchemy.run.ts --stage production

check:
    vp run check:project

test:
    vp run test:project

# Upstream pool 0.22 supports Vitest 4, not Vite+ 1.1's Vitest 5 yet.
test-workers:
    vp run test:workers

format:
    vp fmt

# Real local Workers, isolated storage, screenshot evidence, no production auth.
e2e:
    vp exec playwright test --config tests/e2e-alchemy/playwright.config.ts
