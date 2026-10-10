# Projektor

## Project

This is one private Vite+ project with two Cloudflare Workers in one Alchemy stack.
`src/api` owns the Hono API, authentication and API response shaping.
`src/web` owns the Effront application, ServerFns, UI and browser-session authorization.
`src/services` contains internal retrieval queries, browser authentication and shared domain commands for API and Web, not a published package.
`src/db` contains the schema, `migrations/` the maintained SQL migrations, and `src/types` the shared internal types.
Private `#db`, `#services`, `#commands`, `#types` and `#plugin-sdk` imports resolve inside this project.
Do not recreate workspace packages, a separate infra project, Turbo, Biome or Lefthook.

## Commands

Use the Nix default shell and Vite+.
`vp install --frozen-lockfile` installs dependencies.
`vp run ci` runs formatting, typed lint and every configured test project, including the native Workers API regressions.
`vp run test:workers` selects the native API regression project through the supported `@cloudflare/vitest-plugin`, which supports Vite+'s Vitest 5.
Do not patch the plugin, add a second test CLI or filter unexpected test errors.
The separate screenshot-backed E2E workflow exercises the real API and Web Workers and shared D1 but does not replace every native API regression.
`vp run dev` starts the whole Alchemy stack.
`vp run plan` compares production resources but does not prove a production build or deployment.
`vp run deploy` intentionally deploys both Workers from `alchemy.run.ts` and requires operator authorization.
`vp run e2e` runs the real local Worker/browser acceptance workflow with screenshots.
The native Cloudflare test plugin uses its public local options directly, without a Wrangler TOML or custom parser.
CI uses the shared setup actions and Nix inputs from the Vite+ app template.
The only workflow checks pull requests and main, then deploys production after successful checks on a main push.
Do not add docs, plugin release or preview-link workflows.
Use `vp` for supported operations, including install, update, tests and task execution; use Bun directly only for an operation Vite+ cannot perform.
The pnpm 12 backend retains its default release-age window without exclusions; reviewed esbuild/workerd lifecycle permission lives in `pnpm-workspace.yaml`.
The shell, locked Nix inputs, TypeScript 7, compiler preset versions and package-manager version track `template-vite-plus-app` revision `fcbfdb567154ca9264598bb5c6dd50713898184c`.
This Worker application does not publish the template's Bun CLI executable, so CLI packing, npm publication checks and Nix CLI package outputs do not apply.
Alchemy CLI supplies the native Worker host during development and deployment; a standalone root `vp build` lacks that host and is not an application task.
`vp run e2e` builds both actual Worker artifacts with the official acceptance-only host and exercises them locally.

## Implementation

Prefer framework-native page navigation, URL-backed tabs and native forms.
Define each operation separately with `ServerFn.make`, with concrete Effect schemas and domain authorization.
Keep SSR data canonical and client state limited to drafts, selections and transient feedback.
Use TanStack Form with Effect standard schemas for client-managed forms.
Resolve native request dependencies only at execution boundaries.
Entity retrieval and pre-mutation visibility checks use shared direct D1 queries.
Each browser ServerFn calls its concrete shared command with verified request identity and workspace capabilities, not HTTP endpoints or a generic dispatcher.
Browser Access/development authentication and D1/R2 file storage are shared with API adapters without a Web-to-API service binding.
The API retains bearer/OAuth authentication and HTTP shaping, while Web retains browser-only session, same-origin, UI and upload-limit boundaries.
Web has no API binding, API_BASE or OAuth signing JWT secret.
Both Workers share the existing storage identities and rate-limiter namespace, with environment differences resolved by aggregate Layers.
Never introduce direct browser backend fetches, generic mutation dispatchers or upload-size bypasses.
Direct DB reads must preserve workspace/project visibility, including authorized archived entity reads.
Authentication and response/UI shaping belong at their application boundaries, not in internal retrieval queries.
Use shadcn Base UI generated components with minimal changes.
See [SHADCN.md](SHADCN.md) for the generated component inventory, purposeful customizations and update procedure.
Overview and Metrics share the official shadcn/Recharts flow charts; CFD stacks raw status counts once, not pre-cumulative values.
Keep project navigation edge-to-edge while normal page content retains desktop/mobile gutters below its border; Wiki owns its inner padding.
Use the theme border token for shell dividers and preserve native full-width Markdown tables with overflow contained by their rendering boundary.
Document purposeful generated-source deviations in the changed file, except formatting/linter changes.
Use Comark for untrusted dynamic Markdown, not Effront's static Markdown renderer, and preserve sanitization.
Do not edit README.md without a specific request.
Keep temporary reports and screenshots under ignored `tmp/` or acceptance-output directories.

## Production Safety

`alchemy.ts` declares both Workers and `alchemy.run.ts` deploys them together.
LocalLayer and ProductionLayer aggregate environment-specific settings, adoption and storage/secret bindings, selected once at the composition boundary.
Worker declarations resolve dependencies and dynamic imports only; Web routing and response behavior belong in `src/web/worker.ts`.
Preserve physical Worker names `projektor` and `projektor-frontend`, the fixed account, storage IDs, API cron and the existing `RATE_LIMITER` / `RateLimiter` binding.
Existing production D1/KV/R2 are external bindings, not resources to recreate or migrate automatically.
Do not replay the historical unbound WorkspaceHub migration.
Production inherits the existing JWT_SECRET through a standard Cloudflare `inherit` binding when no local value is supplied.
Only initial secret creation needs JWT_SECRET through Alchemy's standard redacted configuration; explicitly supplying a value updates it.
If the Worker has no existing secret, supply the initial value once; do not silently generate a replacement.
Cloudflare authentication selects the deployment account, without a custom fixed-account rejection or Access-confirmation flag.
Existing Access policies remain external and unchanged.
Worker runtime capture must never resolve deployment secrets or register local storage.
Development uses local Alchemy state; production uses Alchemy's official encrypted Cloudflare state store so state survives ephemeral CI runners.
CI serializes production deployments and uses the available organization `CLOUDFLARE_API_TOKEN` secret with the configured account, without injecting JWT_SECRET on every run.
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
The fork replaces Astro/Preact Web with Effront/React SSR, native forms and scoped ServerFns, Base UI and dynamic Comark rendering.
Application-level styles adapt shared navigation spacing, sidebar/table dividers and Markdown table overflow without modifying generated Base UI primitives.
The official shadcn Chart/Recharts integration replaces uPlot and the overview's independent thick-stroke SVG; Overview and Metrics share seven flow-chart implementations with raw-count stacking, native tooltips and theme tokens.
The Wiki mobile page-tree drawer and backdrop begin below the header and remain below its z-index, while the native application Sidebar keeps its full-height modal behavior.
Groups retains its page heading and access explanation; Comark code blocks use readable GitHub light/dark palettes selected by the existing theme preference.
It adds shared internal D1 retrieval and domain commands while keeping application-specific authorization, API responses and MCP protocol behavior at their boundaries.
Browser authentication, updates and file transfers execute against shared native D1/KV/R2 capabilities without Web-to-API HTTP or service bindings.
Deployment uses one source-owned Alchemy stack instead of example-repository deployment artifacts or operator Wrangler commands.
Deployment uses standard Alchemy configuration without custom confirmation flags, preflight gates or secret-value validation.
Environment differences are provided through aggregate Effect Layers rather than leaf-level local/production branches, and runtime request handling stays outside Worker declarations.
JWT secrets remain Cloudflare-owned across normal deployments through standard binding inheritance, without reading their values or storing them in project state.
The project is consolidated into one root package and Vite+ toolchain instead of private workspace packages.
Vite+ owns all task entry points without Just, formatting/lint settings match the Vite+ app template, and tests use standard isolated projects rather than a runtime-plugin mode branch or test-runner alias shim.
TypeScript inherits the template's strictest and node-ts presets, with Vite's bundled module resolution, React JSX, Worker runtime types, aliases and maintained-source scope.
The existing application/SDK contracts retain three explicit compatibility settings: exact optional properties, indexed-property syntax and unchecked index access are not additionally tightened in this toolchain migration; standard strict checking and the other preset checks remain enabled.
Parameter properties are expanded to ordinary declarations and assignments for the template's erasable-syntax setting without changing their runtime values or error protocol.
PR #5's compatible mature dependency updates and range policy are applied here without merging its obsolete Bun/Turbo/eight-package/docs topology; exact template versions and Alchemy's exact paired peer contracts remain intentional.
The old Workers pool is replaced with the maintained Vitest plugin, and immediate command rejections are awaited inside the affected MCP adapters instead of suppressing unhandled errors.
Test failures and unhandled rejections are not globally filtered by domain error kind.
The documentation app and docs directory are intentionally removed at the user's request.
Maintain this compact divergence record alongside behavior/configuration changes.
Use `git diff ab122cbea1bae7efce8abe2345ce07375b9dcd13 -- src migrations alchemy.ts alchemy.run.ts vite.config.ts package.json .github` when reviewing fork changes.
