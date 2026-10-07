# Projektor

## Project

This is one private Vite+ project with two Cloudflare Workers in one Alchemy stack.
`src/api` owns the Hono API, authentication and API response shaping.
`src/web` owns the Effront application, ServerFns, UI and browser-session authorization.
`src/services` contains internal pure retrieval queries shared by API and Web, not a published package.
`src/db` contains the schema, `migrations/` the maintained SQL migrations, and `src/types` the shared internal types.
Private `#db`, `#services`, `#types` and `#plugin-sdk` imports resolve inside this project.
Do not recreate workspace packages, a separate infra project, Turbo, Biome or Lefthook.

## Commands

Use the Nix default shell and Vite+.
`vp install --frozen-lockfile` installs dependencies.
`vp run ci` runs formatting, typed lint and the supported API Node, Web and database/service tests.
`just test-workers` preserves the native API regression entry point, currently blocked before test collection by Cloudflare pool 0.22's Vitest 5 incompatibility with Vite+ 1.1.
Do not patch the pool, add a second test CLI or describe those blocked regressions as passing.
The separate screenshot-backed E2E workflow exercises the real API and Web Workers and shared D1 but does not replace every native API regression.
`just dev` starts the whole Alchemy stack.
`just plan` compares production resources but does not prove a production build or deployment.
`just deploy` intentionally deploys both Workers from `alchemy.run.ts` and requires operator authorization.
`just e2e` runs the real local Worker/browser acceptance workflow with screenshots.
`wrangler.test.toml` is only the native Cloudflare test-pool configuration, not a deployment entry point.
CI uses the shared setup actions and Nix inputs from the Vite+ app template.
Do not add docs, plugin or automatic deployment workflows to the minimal CI.

## Implementation

Prefer framework-native page navigation, URL-backed tabs and native forms.
Define each operation separately with `ServerFn.make`, with concrete Effect schemas and domain authorization.
Keep SSR data canonical and client state limited to drafts, selections and transient feedback.
Use TanStack Form with Effect standard schemas for client-managed forms.
Use Effect HTTP and provide services only at execution boundaries.
Build requests separately from execution and decode responses with their concrete `HttpClientResponse.schemaBodyJson` schema.
Never introduce direct browser backend fetches, generic mutation dispatchers or upload-size bypasses.
Direct DB reads must preserve workspace/project visibility, including authorized archived entity reads.
Authentication and response/UI shaping belong at their application boundaries, not in internal retrieval queries.
Use shadcn Base UI generated components with minimal changes.
Document purposeful generated-source deviations in the changed file, except formatting/linter changes.
Use Comark for untrusted dynamic Markdown, not Effront's static Markdown renderer, and preserve sanitization.
Do not edit README.md without a specific request.
Keep temporary reports and screenshots under ignored `tmp/` or acceptance-output directories.

## Production Safety

`alchemy.ts` declares both Workers and `alchemy.run.ts` deploys them together.
Preserve physical Worker names `projektor` and `projektor-frontend`, the fixed account, storage IDs, API cron and the existing `RATE_LIMITER` / `RateLimiter` binding.
Existing production D1/KV/R2 are external bindings, not resources to recreate or migrate automatically.
Do not replay the historical unbound WorkspaceHub migration.
Production requires the existing JWT_SECRET and operator-confirmed hostname-wide Cloudflare Access.
Worker runtime capture must never run deployment preflight or register local storage.
Do not deploy, rotate secrets, modify Access or destroy resources during validation.

## Fork Record

Upstream: https://github.com/TAJD/projektor
Fork: https://github.com/totto2727-org/projektor
Immutable fork point: `ab122cbea1bae7efce8abe2345ce07375b9dcd13`.
Reviewed upstream-comparison baseline: `6c4b69697ec34ec6daa7a6773b4b6db50732b585`.
The fork replaces Astro/Preact Web with Effront/React SSR, native forms and scoped ServerFns, Base UI and dynamic Comark rendering.
It adds shared internal D1 retrieval while keeping API contracts, authorization, mutations and MCP behavior at the application boundary.
Deployment uses one source-owned Alchemy stack instead of example-repository deployment artifacts or operator Wrangler commands.
The project is consolidated into one root package and Vite+ toolchain instead of private workspace packages.
The documentation app and docs directory are intentionally removed at the user's request.
Maintain this compact divergence record alongside behavior/configuration changes.
Use `git diff ab122cbea1bae7efce8abe2345ce07375b9dcd13 -- src migrations alchemy.ts alchemy.run.ts vite.config.ts package.json .github` when reviewing fork changes.
