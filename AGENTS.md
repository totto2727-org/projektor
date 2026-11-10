# Projektor

## Project

This is one private Vite+ project with three Cloudflare Workers in one Alchemy stack.
`src/api` owns the external Hono REST, MCP and OAuth interfaces and API response shaping.
`src/web` owns the Effront application, ServerFns, UI and browser request boundaries.
The private Core Worker owns shared domain operations, persistent authorization, provisioning and all D1 access.
API and Web call Core directly through native service bindings, never through each other's public URLs.
`src/services` and `src/db` are Core implementation modules, not published packages or adapter capabilities.
`src/db` contains the schema, `migrations/` the maintained SQL migrations, and `src/types` the shared internal types.
Private `#db`, `#services`, `#commands`, `#types` and `#plugin-sdk` imports resolve inside this project.
Do not recreate workspace packages, a separate infra project, Turbo, Biome or Lefthook.

## Commands

Use the Nix default shell and Vite+.
`vp install --frozen-lockfile` installs dependencies.
`.node-version` pins Node.js 24.11.0 for Vite+ managed Node mode (`vp env on node`).
In system-first mode, the Nix shell's Node.js takes precedence. Use `vp env exec --node 24.11.0 node --version` to verify the pinned runtime explicitly.
`packageManager` pins pnpm independently; `package.json` has no `engines` constraints.
`vp run ci` runs formatting, typed lint and every configured test project, including the native Workers API regressions.
`vp run test:workers` selects the native API regression project through the supported `@cloudflare/vitest-plugin`, which supports Vite+'s Vitest 5.
Do not patch the plugin, add a second test CLI or filter unexpected test errors.
The screenshot-backed E2E workflow exercises the real Worker application and persistent storage but does not replace every native API regression.
`vp run dev` starts the whole Alchemy stack.
`vp run plan` compares production resources but does not prove a production build or deployment.
`vp run deploy` intentionally deploys the whole Worker stack from `alchemy.run.ts` and requires operator authorization.
`vp run e2e` runs the real local Worker/browser acceptance workflow with screenshots.
The native Cloudflare test plugin uses its public local options directly, without a Wrangler TOML or custom parser.
The native API test Worker has no D1 or file-storage binding, while its private Core test Worker owns the real storage.
`src/api/test/fixture-api.ts` supplies storage setup proxies through the test-only Core entrypoint, not through production RPC operations.
Confine fixture SQL, request-local configuration sessions and failure-injection modes to native test entrypoints and test helpers, outside production Core exports.
Runtime consumers import `projektor/core-client` so the supported Vite dependency optimizer can bundle the public SDK's runtime exports without its deployment providers.
CI uses the shared setup actions and Nix inputs from the Vite+ app template.
The CI workflow checks pull requests and main without deployment credentials.
The separate production deployment workflow runs only after successful CI for a main push in this repository and checks out that CI run's exact commit.
Do not add docs, plugin release or preview-link workflows.
Use `vp` for supported operations, including install, update, tests and task execution; use Bun directly only for an operation Vite+ cannot perform.
The pnpm 12 backend uses its default release-age window and strict verification without release-age exceptions.
Reviewed esbuild/workerd lifecycle permission remains in `pnpm-workspace.yaml`.
The shell, locked Nix inputs, TypeScript 7, compiler preset versions and package-manager version track `template-vite-plus-app` revision `fcbfdb567154ca9264598bb5c6dd50713898184c`.
This Worker application does not publish the template's Bun CLI executable, so CLI packing, npm publication checks and Nix CLI package outputs do not apply.
Alchemy CLI supplies the native Worker host during development and deployment; a standalone root `vp build` lacks that host and is not an application task.
`vp run e2e` builds the actual Worker artifacts with the official acceptance-only host and exercises them locally.

## Implementation

Prefer framework-native page navigation, URL-backed tabs and native forms.
Define each operation separately with `ServerFn.make`, with concrete Effect schemas and domain authorization.
Keep SSR data canonical and client state limited to drafts, selections and transient feedback.
Use TanStack Form with Effect standard schemas for client-managed forms.
Resolve native request dependencies only at execution boundaries.
Entity retrieval, authorization and mutations execute in Core through concrete, typed domain operations.
Each browser ServerFn calls its named Core operation, not a public HTTP endpoint, generic dispatcher or remote SQL interface.
Core verifies credentials and resolves current membership, credential confinement and effective project permissions.
Never accept a caller-supplied user ID, role, SQL predicate or storage capability as authorization.
API retains bearer/OAuth protocol and HTTP shaping, while Web retains browser-only request, same-origin, UI and upload-limit boundaries.
Web has no API binding, API_BASE, D1 binding or OAuth signing JWT secret.
API has no D1 binding, including in scheduled handlers, authentication, rate-limit fallbacks and Durable Objects.
The official OAuth provider retains API's dedicated `OAUTH_KV` protocol binding and signing secret.
Core shares that same OAuth KV namespace for current grant authorization and maintenance, while business KV and R2 remain exclusive to Core.
Do not replace the provider's token lifecycle with a custom protocol or expose generic KV operations through production RPC.
Keep native bindings request-local and resolve them lazily rather than capturing an earlier request's environment.
Return validated public success or failure data across RPC, not custom Error instances, stacks, causes or database diagnostics.
Log unexpected diagnostics at their origin and expose only a safe error and occurrence ID.
Stream binary transfers through the same private service binding without JSON or base64 buffering.
Preserve the existing physical storage and rate-limiter namespace identities.
Never introduce direct browser backend fetches, blind mutation retries or upload-size bypasses.
Core reads preserve workspace/project visibility, including authorized archived entity reads.
HTTP, MCP and UI response shaping remain in their external adapters.
Use shadcn Base UI generated components with minimal changes.
See [SHADCN.md](SHADCN.md) for the generated component inventory, purposeful customizations and update procedure.
Overview and Metrics share the official shadcn/Recharts flow charts; CFD stacks raw status counts once, not pre-cumulative values.
Keep project navigation edge-to-edge while normal page content retains desktop/mobile gutters below its border; Wiki owns its inner padding.
Use the theme border token for shell dividers and preserve native full-width Markdown tables with overflow contained by their rendering boundary.
Document purposeful generated-source deviations in the changed file, except formatting/linter changes.
Use Comark for untrusted dynamic Markdown, not Effront's static Markdown renderer, and preserve sanitization.
Do not edit README.md without a specific request.
Keep temporary reports and screenshots under ignored `tmp/` or acceptance-output directories.

## Review gates

- Verify the actual API, Web and Core artifacts together with native service bindings and no DB binding at either public adapter.
- Check current membership and project grants inside Core, including credential workspace confinement, revoked grants, archived reads and interactive-human-only operations.
- Test safe expected errors, malformed replies, native transport failures, cancellation and concurrent requests using different bindings.
- Verify browser same-origin rules, SSR and ServerFn parity, cold no-JavaScript navigation, and desktop/mobile keyboard behavior.
- Exercise file authorization before bytes, metadata-only HEAD, streaming integrity and cancellation without JSON/base64 transfer.
- Keep failed writes non-destructive, bound D1 statement parameters and cleanup batches, and preserve retry information when storage deletion fails.
- Test delayed UI mutations with edits made while the request is pending, rather than checking only immediate success.
- Keep cron bounded and single-owned, and verify the deployed names, domains, storage IDs and Durable Object identities independently of application tests.
- Do not turn inventory coverage or passing unit tests into a claim of complete security assurance or measured performance improvement.

## Migration safety

Keep applied historical SQL and migration bookkeeping unchanged.
The installed Alchemy host skips an applied file by name, not by matching its stored hash, so editing history can silently produce different databases.
Populated legacy upgrades through `0035`, `0041`, `0050` and `0060` can encounter generated-slug collisions with already occupied names.
An appended migration cannot repair a database that fails before reaching it.
Before resuming such a legacy upgrade, use an offline restored copy and an explicitly approved old-to-new mapping against the complete workspace namespace.
Preserve page identity, redirect ownership, versions and foreign keys, then replay the unchanged remaining history and verify the result.
Do not automatically rename user content, fabricate ledger entries, replay production migrations or treat fresh empty replay as populated-upgrade proof.
Production migration or data repair requires separate operator authorization and a recoverable backup.

## Production Safety

`alchemy.ts` declares the public API, public Web and private Core Workers, and `alchemy.run.ts` deploys the stack together.
LocalLayer and ProductionLayer aggregate environment-specific settings, adoption and storage/secret bindings, selected once at the composition boundary.
Worker declarations resolve dependencies and dynamic imports only; Web routing and response behavior belong in `src/web/worker.ts`.
Preserve physical Worker names `projektor` and `projektor-frontend`, the fixed account, storage IDs, API cron and the existing `RATE_LIMITER` / `RateLimiter` binding.
Core has no public domain, route, workers.dev URL or preview URL.
Only Core receives D1, and API's existing cron forwards maintenance to Core without moving the schedule or adding a second trigger.
Preserve the dedicated `OAUTH_KV` binding on API for the official provider and on Core for grant checks and cleanup, using the same existing namespace in both Workers.
Existing production D1/KV/R2 are external bindings, not resources to recreate or migrate automatically.
Do not replay the historical unbound WorkspaceHub migration.
Production inherits the existing JWT_SECRET through a standard Cloudflare `inherit` binding when no local value is supplied.
Only initial secret creation needs JWT_SECRET through Alchemy's standard redacted configuration; explicitly supplying a value updates it.
If the Worker has no existing secret, supply the initial value once; do not silently generate a replacement.
Cloudflare authentication selects the deployment account, without a custom fixed-account rejection or Access-confirmation flag.
Existing Access policies remain external and unchanged.
Worker runtime capture must never resolve deployment secrets or register local storage.
Development uses local Alchemy state; production uses Alchemy's official encrypted Cloudflare state store so state survives ephemeral CI runners.
The deployment workflow serializes production deployments and uses the available organization `CLOUDFLARE_API_TOKEN` secret with the configured account, without injecting JWT_SECRET on every run.
The main deployment passes Alchemy's standard `--yes` flag; Alchemy may bootstrap or upgrade its own state-store infrastructure, separate from the application's external storage and Access policies.
Switching from local production state does not upload or migrate the local files automatically: retain those files as operator recovery evidence, and the first remote-state deployment uses the existing explicit adoption policy and fixed Worker identities.
No deployment state or credential values belong in GitHub artifacts, caches or the repository.
Do not deploy, rotate secrets, modify Access or destroy resources during validation.

## Fork Record

Upstream: https://github.com/TAJD/projektor
Fork: https://github.com/totto2727-org/projektor
Immutable fork point: `ab122cbea1bae7efce8abe2345ce07375b9dcd13`.
Upstream comparison revision: the immutable fork point above.
Previous fork SSR checkpoint: `6c4b69697ec34ec6daa7a6773b4b6db50732b585`.
The Web Worker uses Effront 0.4's configured `@effront/alchemy/cloudflare/application` helper with the actual application's type-only import, preserving construction capabilities and per-request application Layers without an application-owned dynamic loader.
The four Effront consumers request `^0.4.1` and the official Nix/Vite+ generated lockfile resolves unpatched 0.4.1, without consumer declaration patches or scoped transitive overrides.
The temporary exact Effront 0.4.1 release-age exceptions expired on 2026-11-10T12:45:19.626Z and are removed.
Dependency verification and the normal release-age policy apply to the unchanged lockfile.
SSR bundling uses the framework defaults without the former Markdown compatibility override of Rolldown's platform to `neutral`.
The Effect runtime and browser/Node platform packages use normal `^4.0.2` ranges to express Effront's minimum peer requirement, without pinning around Alchemy beta.81's `effect/Crypto` compatibility.
The permanent Worker type regression preserves concrete construction/request requirements and rejects leaked `any` types.
The fork replaces Astro/Preact Web with Effront/React SSR, native forms and scoped ServerFns, Base UI and dynamic Comark rendering.
Application-level styles adapt shared navigation spacing, sidebar/table dividers and Markdown table overflow without modifying generated Base UI primitives.
The official shadcn Chart/Recharts integration replaces uPlot and the overview's independent thick-stroke SVG; Overview and Metrics share seven flow-chart implementations with raw-count stacking, native tooltips and theme tokens.
The Wiki mobile page-tree drawer and backdrop begin below the header and remain below its z-index, while the native application Sidebar keeps its full-height modal behavior.
Groups retains its page heading and access explanation; Comark code blocks use readable GitHub light/dark palettes selected by the existing theme preference.
It adds shared internal retrieval and domain commands behind a private Core Worker, while REST, MCP and Effront remain external adapters.
Native Core service bindings replace the former direct Web/API D1 access to centralize persistent policy and storage ownership.
This architecture does not imply a performance improvement.
Deployment uses one source-owned Alchemy stack instead of example-repository deployment artifacts or operator Wrangler commands.
Production deployment is a separate workflow gated on successful main-push CI, with the tested revision, production environment and serialized deployments preserved.
Deployment uses standard Alchemy configuration without custom confirmation flags, preflight gates or secret-value validation.
Environment differences are provided through aggregate Effect Layers rather than leaf-level local/production branches, and runtime request handling stays outside Worker declarations.
JWT secrets remain Cloudflare-owned across normal deployments through standard binding inheritance, without reading their values or storing them in project state.
The project is consolidated into one root package and Vite+ toolchain instead of private workspace packages.
`.node-version` pins Node.js 24.11.0 for Vite+ managed mode instead of declaring Node/pnpm compatibility ranges through `engines`; the existing pnpm `packageManager` pin remains unchanged.
Vite+ owns all task entry points without Just, formatting/lint settings match the Vite+ app template, and tests use standard isolated projects rather than a runtime-plugin mode branch or test-runner alias shim.
The root Vite+ config uses `@totto2727/gitignore-patterns` filesystem snapshots for formatting and lint exclusions; the frontend acceptance config inherits those settings, while the standalone build-only API config needs no check settings.
TypeScript inherits the template's strictest and node-ts presets, with Vite's bundled module resolution, React JSX, Worker runtime types, aliases and maintained-source scope.
The existing application/SDK contracts retain three explicit compatibility settings: exact optional properties, indexed-property syntax and unchecked index access are not additionally tightened in this toolchain migration; standard strict checking and the other preset checks remain enabled.
Parameter properties are expanded to ordinary declarations and assignments for the template's erasable-syntax setting without changing their runtime values or error protocol.
PR #5's compatible mature dependency updates and range policy are applied here without merging its obsolete Bun/Turbo/eight-package/docs topology; exact template versions and Alchemy's exact paired peer contracts remain intentional.
The old Workers pool is replaced with the maintained Vitest plugin, and immediate command rejections are awaited inside the affected MCP adapters instead of suppressing unhandled errors.
Test failures and unhandled rejections are not globally filtered by domain error kind.
The documentation app and docs directory are intentionally removed at the user's request.
Maintain this compact divergence record alongside behavior/configuration changes.
Use `git diff ab122cbea1bae7efce8abe2345ce07375b9dcd13 -- src migrations alchemy.ts alchemy.run.ts vite.config.ts package.json .github` when reviewing fork changes.
