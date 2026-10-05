default:
    @just --list

install:
    corepack pnpm install --frozen-lockfile

# Alchemy owns the local Workers, bindings and Vite build lifecycle.
dev:
    corepack pnpm exec alchemy dev --config alchemy.run.ts

# Planning compares resources. It is not a production build or upload.
plan:
    corepack pnpm exec alchemy plan --config alchemy.run.ts --stage production

# Requires the existing JWT_SECRET, Cloudflare profile and confirmed Access.
# Execute only as an intentional operator action.
deploy:
    corepack pnpm exec alchemy deploy --config alchemy.run.ts --stage production

check:
    corepack pnpm exec vp run ci:check
    corepack pnpm exec vp run ci:format

test:
    corepack pnpm exec vp run test:packages

format:
    corepack pnpm exec vp fmt

# Official local runtime host builds both Workers without production credentials.
e2e:
    corepack pnpm exec playwright test --config tests/e2e-alchemy/playwright.config.ts
