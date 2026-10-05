# Fork differences from upstream

This is the maintained source-fork record for [`totto2727-org/projektor`](https://github.com/totto2727-org/projektor), relative to [`TAJD/projektor`](https://github.com/TAJD/projektor).
It covers already-merged workspace fixes, the Effront SSR port, replacement of the legacy frontend, and the source-owned Alchemy/VitePlus integration.
It is maintained architecture documentation, not a work log or task ledger.
Deployment-repository customization belongs in that repository, not in this record.

## Immutable fork point and comparison baseline

| Reference | Commit | Meaning |
| --- | --- | --- |
| Immutable fork point | [`ab122cbea1bae7efce8abe2345ce07375b9dcd13`](https://github.com/TAJD/projektor/commit/ab122cbea1bae7efce8abe2345ce07375b9dcd13) | Historical upstream commit from which this fork first diverged. Never update this value on an upstream sync. |
| Reviewed comparison baseline | [`6c4b69697ec34ec6daa7a6773b4b6db50732b585`](https://github.com/totto2727-org/projektor/commit/6c4b69697ec34ec6daa7a6773b4b6db50732b585) | Reviewed source snapshot used for the current comparison. This fork's standalone SSR checkpoint is distinct from its immutable upstream fork point. Advance only after review. |
| PR #1 patch | [`290f6644d8ced6d70fe1434437624d59015ff22d`](https://github.com/totto2727-org/projektor/commit/290f6644d8ced6d70fe1434437624d59015ff22d) | Workspace-aware project creation. Its sole parent is the immutable fork point. |
| First divergent first-parent commit | [`590ee98ec00b18b34e39d009473d3030bfc39b43`](https://github.com/totto2727-org/projektor/commit/590ee98ec00b18b34e39d009473d3030bfc39b43) | Merge of [fork PR #1](https://github.com/totto2727-org/projektor/pull/1). Its first parent is the fork point, and its second parent is the PR #1 patch. |
| Legacy frontend checkpoint | [`2077f7cfc0ba3e4eba130d8157626560d291bd1d`](https://github.com/totto2727-org/projektor/commit/2077f7cfc0ba3e4eba130d8157626560d291bd1d) | Complete runtime-workspace and hydration fixes before the independent SSR app. Historical Astro/Preact paths below refer to this snapshot. |
| Standalone SSR checkpoint | [`6c4b69697ec34ec6daa7a6773b4b6db50732b585`](https://github.com/totto2727-org/projektor/commit/6c4b69697ec34ec6daa7a6773b4b6db50732b585) | Effront SSR, native forms, Effect HTTP, timestamp and navigation fixes before Alchemy integration and the `apps/ssr` to `apps/web` move. |

The historical relationship is verified from Git parents, not inferred from matching file content or the current upstream branch name.
`git merge-base HEAD ab122cbea1bae7efce8abe2345ce07375b9dcd13` also returns the fork point for the reviewed history.

```sh
git show -s --format='%H%n%P%n%s' 290f6644d8ced6d70fe1434437624d59015ff22d
git show -s --format='%H%n%P%n%s' 590ee98ec00b18b34e39d009473d3030bfc39b43
git rev-list --first-parent --reverse ab122cbea1bae7efce8abe2345ce07375b9dcd13..HEAD
```

## Complete comparison and traceability

The following commands enumerate every tracked source/configuration/test/documentation difference from the reviewed baseline, including deletions and rename detection.
Use the reviewed comparison baseline, not an automatically refreshed `upstream/main` ref.
The baseline is a fork source checkpoint, not a claim that upstream published the SSR port.
Historical fork changes preceding it remain recorded below; use the immutable fork point for the full historical upstream-to-fork diff.

```sh
baseline=6c4b69697ec34ec6daa7a6773b4b6db50732b585
git diff --find-renames --name-status "$baseline" HEAD
git diff --find-renames "$baseline" HEAD
# Include tracked working-tree changes before committing:
git diff --find-renames --name-status "$baseline"
git diff --find-renames "$baseline"
# New files are not included in git diff until tracked:
git ls-files --others --exclude-standard
git status --short
```

Ignored dependencies, build output and temporary reports are not source inventory.
Its complete historical diff remains reproducible using the pinned standalone SSR commit above; concrete path counts are not an architecture contract.
Current comparison coverage is organized below by area, so removals and renamed files are not silently presented as retained source.

| Current comparison area | Paths and coverage | Purpose and operational impact |
| --- | --- | --- |
| Frontend replacement | Entire former Astro/Preact `apps/web` source, configuration, tests and E2E suite, compared with current `apps/web` | Delete the legacy app, then move the Effront app from `apps/ssr` into the canonical `apps/web` location. Preserve applicable fonts/assets and theme contracts as owned frontend inputs, not build-time imports from a second app. The similar product UI uses maintained generated shadcn/ui Base UI primitives rather than requiring exact legacy DOM/CSS parity. Old islands and signals are no longer an active runtime contract. |
| Effront application and tests | `apps/web/src/**`, `apps/web/public/**`, frontend manifests and Vite/test/type configuration | React SSR with native forms, request-local identity, shared direct D1 reads, native service-binding HTTP mutations and framework-owned navigation/refresh. Retain maintained regression tests described below under the new path. |
| Source-owned deployment | Root `alchemy.run.ts`, `infra/{api,config}.ts`, configuration regressions, `justfile`, frontend/API entry and hosting integration | One Alchemy stack owns both logical apps with `localState()` and Cloudflare providers. Use official Effront `0.2.0` and Alchemy `2.0.0-beta.79`. Production preflight checks the resolved account, Access confirmation and existing secret before Worker registration. Native public Worker props use a runtime-phase identity branch without deployment config or child resources; both local Workers share one `LocalDatabase` declaration. |
| Shared data reads | `packages/data-services/src/**`, its query regressions, API service adapters and Web server loaders | Pure Effect-based D1 reads are reused across API and Web. Authentication, authorization/visibility policy, mutations and API/UI shaping stay in apps. Web binds the same external production D1 ID as the API, not a replacement database. |
| Resource and security compatibility | Stack configuration, API Worker bindings and frontend API transport configuration | Preserve API Worker `projektor`, frontend Worker `projektor-frontend`, D1/KV/R2 identities and Access enforcement. The existing `RATE_LIMITER` binding targets `RateLimiter`, while `WorkspaceHub` remains unbound and historical v1/v2 migrations are not replayed. Use public `Worker.bind` references to the existing external storage IDs rather than adopting data stores as new Alchemy-managed resources. Supply the actual existing `JWT_SECRET` from the deployment environment rather than generating a replacement. |
| Toolchain and workspace integration | Root/package manifests, workspace configuration, lockfile, VitePlus configuration, `justfile`, CI and hooks | Replace Turbo/Biome/Lefthook with VitePlus integrated task/test/type-check and Oxlint/Oxfmt commands. Adapt package references and tasks to canonical `apps/web`. Only `ci.yml` remains active, running VitePlus core/infra formatting and typed lint, API/Web/DB/data-services tests and native Alchemy `test:infra` configuration regressions. `just check` shares CI's check/format tasks, with no docs/plugin pipeline or deployment automation. Retained Astro docs tasks are optional local maintenance, not CI jobs. TypeScript `6.0.3` remains an API AST-test library rather than a standalone `tsc` runner; workspace TypeScript/Node-type overrides preserve consistent Vite peer type identities. |
| Retired static release/hosting inputs | Former release artifact, static asset and standalone Wrangler tasks/configuration, including obsolete `apps/api/src/test/release-config.node.test.ts` | The old config-only example repository and Wrangler deployment workflow are not the fork's operator contract. Native Alchemy infra configuration regressions replace the deleted Wrangler release-artifact test as the deployment contract. Do not use old static-site output or point release consumers at removed Astro files. |
| Maintained documentation | `AGENTS.md`, this record, generated contributing conventions, deployment guide, historical `docs/superpowers/plans/2026-07-26-feedback-page-layout-plan.md` corrections and necessary source-reference updates | Describe the current architecture and retain full fork history. The historical feedback-page plan is not an active workspace specification. Conventions mirror the AGENTS generator exactly. Root `README.md` and `apps/docs/src/content/docs/philosophy/**` remain protected and unedited. |

## Historical workspace fixes, retained in the fork history

These changes were originally made in the now-removed Astro/Preact frontend.
Their historical paths are discoverable in the legacy checkpoint, not claims that the old components still exist in current `apps/web`.
The SSR app retains the runtime-selection principle while replacing the old implementation.

| Historical change | Historical affected area | Purpose and retained behavioral requirement |
| --- | --- | --- |
| [PR #1](https://github.com/totto2727-org/projektor/pull/1) project creation | `ProjectList.tsx` and tests | Discover memberships, offer only owner/admin workspaces, auto-select only a single eligible workspace, require explicit selection among several, and prevent loading/error/no-permission submission. Send selected workspace context and preserve created-project metadata. Public viewers cannot create projects. |
| Scoped request ordering | `WorkspaceBoundary.tsx`, `project-context.ts`, project roots and `resolve-project-id.ts` | Resolve project UUID/key/slug and workspace before scoped requests. Reject unknown or ambiguous selections, respect explicit scope and prevent stale async resolution from replacing newer selection. |
| Retained-state hydration | `WorkspaceBoundary.tsx` and regressions | Keep server markup and first hydration render deterministic before adopting retained client state. This corrected orphaned loading markup during Astro tab navigation, not an empty-issues backend bug. |
| Required catalog identity | `project-context.ts`, `board-utils.ts`, issue-list types and access helpers | Require the existing API's `workspace_slug` metadata and use nullable selection instead of a fetched project with optional identity. Backend response shape is unchanged. |
| Projectless settings and My Issues | ConnectAgentGuide, ConnectorManager, GroupManager, TokenManager and MyIssues | Select settings scope from memberships/URL, not hostname. Aggregate My Issues per accessible membership with workspace-bearing rows and links, without inventing a cross-workspace issues endpoint. |
| Navigation, prefetch and branding | Project navigation, issue lookups, issue URLs, `issue-prefetch.ts`, `brand.ts` and access helpers | Preserve workspace/project metadata, distinguish entity IDs from project hints, skip unscoped prefetch and reject mismatched handoffs. Keep genuinely global discovery/global authorization checks global. Native file subresources retain backend-supported scoped transport. |
| `PUBLIC_WORKSPACE_SLUG` retirement | Former Astro pages and `.env.example` | Remove all 17 former page consumers and 28 workspace props. Runtime identity replaces the retired environment variable, not another build-time tenant override. |
| Honest regression fixtures | Island/helper tests, page-workspace/context/boundary tests, test setup and Playwright configuration/specs | Exercise cold/retained state, scope switches, role gates, ambiguity, required types, prefetch and aggregate links. Remove blanket browser tenant headers and entity-bearing localStorage fixture writes. Fixture API calls supply their own scope. These legacy suites are historical after app deletion. |

## Current Effront SSR contract

The current app lives in `apps/web`; references to `apps/ssr` describe only the standalone checkpoint.
The source port covers Projects/Overview, Issues/My Issues/Epics, Wiki, Feedback, Sprints/Metrics, Groups/Tokens/Connectors, public Share and Help, including dynamic aliases.
Source coverage is not a claim of passing end-to-end behavior across these surfaces.
The frontend supplies context to the existing API authorization, never replaces it.

| Boundary | Current source | Difference and operational impact |
| --- | --- | --- |
| Rendering and routing | `apps/web/src/{effront,entry.effront,entry.workers,page,selection,urls}.ts*` | Effront owns documents, layouts, matching, client navigation, Back/Forward and server-function refresh. Server loaders prepare data before streaming and preserve denial/error status. Native GET selection/filter forms and URL tabs replace browser bootstrap and build-time tenant selection. Entity IDs and project hints remain distinct. |
| Request-local read and HTTP context | `apps/web/src/request.ts`, `server/**`, `http-client-layer.ts` | `/auth/me` verifies the actual browser session through the native `API` service binding. Direct-read scope rejects bearer-token requests/public-viewer identity; Web authorizes workspace/project membership and supplies app-owned visibility predicates to `@projektor/data-services`. Shared queries use request-local D1 and explicit scopes, with UI DTO/error shaping in Web. HTTP builders use Effect `HttpClientRequest` and concrete response schemas inside `Effect.scoped`; mutations and retained auth/share/file operations stay on the service binding. Scope/view caches remain request-local and invalidate after mutations, including uncertain outcomes. No browser direct API fetch or privileged shared token. |
| Forms and canonical state | `features/**/{actions,form-schemas,input-schemas}.ts`, `client/{functions,runtime}.ts*`, `function-result.ts` | Native `useActionState` handles simple mutations. Stateful forms use TanStack Form with Effect `Schema.toStandardSchemaV1`, with independent server validation. Literal authorized `ServerFn.make` operations use fixed API operations. No generic browser HTTP dispatcher, mutation factory, custom router, refresh bus, render-ID protocol or replacement canonical store. Transient controls/drafts and framework optimistic overlays do not replace server props. |
| Attachments | `attachments.ts`, `attachment-actions.ts`, upload component and Wiki editor | Native upload actions and literal inline-image ServerFn preserve drafts/cursors using Effront transport. The 10 MiB total framework body cap includes multipart overhead, while the API's 50 MiB policy remains unchanged. Deleted upload proxies/303 handlers are not restored to bypass the cap. Uncertain uploads are not automatically retried. |
| Authentication and file subresources | `session-navigation.ts`, Worker entry and native account forms | Login/session-refresh/logout perform document transitions, discarding the prior identity's runtime. Validate bounded forms and local return paths. Native file GET/HEAD transport and login forwarding remain narrow, with no arbitrary credential-bearing redirects or generic API proxy. Dynamic HTML/Flight are private and non-cacheable by shared HTTP caches. |
| Presentation and navigation | `brand.ts`, `components/**`, `styles/app.css`, public assets | React retains the product shell, navigation, design-token contracts and similar feature UI while adopting maintained generated shadcn/ui Base UI primitives. Keep generated component changes minimal, with per-file purpose/change notes for intentional customization and app-specific adapters outside generated source. Branding is emitted before paint and never cached across workspaces. Keep keyboard/focus/skip-link and responsive behavior. Unmeasured project tabs scroll within the navigation rather than widening mobile documents; the measured overflow popup is not clipped. |
| Timestamp hydration | `features/timestamp.ts` and regressions | Deterministic explicitly UTC persisted date/time labels avoid Worker/browser timezone mismatches without client timestamp state, suppression or a hydration effect. Local-midnight date inputs and backend timestamp storage are unchanged. |
| Wire and form compatibility | Issues loaders and project actions/tests | Detail DTOs may omit the list-only `assignee_name` alias, normalized to null without accepting malformed values. Blank create/clear descriptions are strings, not unsupported null values. Project keys require the API's leading letter. Maintain these regressions rather than broadening backend contracts. |

## Shared UI and dynamic Markdown integration

The shared-control migration uses 22 generated shadcn `4.21.1` `base-nova` components built on Base UI, plus named app-facing adapters for product-specific prop/behavior compatibility.
Each generated component records the intentional `cn` import alias change to `@/lib/utils` in its own source note.
Keep adapters separate from generated primitives and document further intentional changes, excluding mechanical lint/format edits.
The product UI is intended to remain similar, not an exact legacy DOM/CSS reproduction.

Dynamic user-authored Markdown uses Comark `0.6.2` runtime parsing and `@comark/html` rendering, not Effront's static Markdown compilation.
The runtime keeps parser defaults and adds mdts-style footnotes, math, Mermaid, Shiki and TOC plugins, plus scoped wiki links.
`apps/web/src/components/markdown/render.ts` creates a parser per invocation and sanitizes final authored/plugin HTML and SVG with explicit tag, attribute, style and URL allowlists.
Untrusted HTML never becomes trusted merely because a plugin rendered it; content security stays separate from routing/data loading.

The port retains the original UI limits: story-points-only custom-field editing, parent/children hierarchy without a new reparent control, and local presentation backlog ordering rather than new persisted ordering.
Named issue views are user/workspace/project-scoped sessionStorage per browser tab, never entity-bearing cosmetic localStorage.
API services now delegate reusable read SQL to the shared package; app authorization, validation, mutation behavior and REST/MCP response contracts remain app-owned.
This is a source-layer extraction, not a new browser database surface or a claim that runtime source is unchanged.

## Deployment and verification boundaries

Run `just dev`, `just plan` and `just deploy` from this source repository.
The root stack integrates API and frontend without requiring an example deployment repository or standalone Wrangler deployment.
Production plan/deploy select `--stage production` and require the existing non-empty redacted `JWT_SECRET` plus `PROJEKTOR_ACCESS_CONFIRMED=true` after operator review of existing hostname protection.
That flag is not a remote protection check and creates/resets no Access application or policy.
The production stack binds existing external storage IDs without lifecycle ownership, including the same D1 ID in both Workers.
Local development uses a single native emulated D1 declaration shared by API/Web and applies migrations locally, with separate local KV/R2 resources.
Omitting the production Worker secret is not safe preservation on beta.79, so missing/empty values fail closed.
`just check`, `just test`, `just format` and `just e2e` expose current verification tasks.
`pnpm build` builds retained docs only, while the E2E recipe targets the official local runtime host for the real Worker graph separately from CLI profile authentication.

Alchemy CLI profile authentication is required even for local dev/plan.
Alchemy `2.0.0-beta.79` has no standalone build CLI, and a plan is not a build or evidence of production deployment.
Do not create replacement Cloudflare resources, rotate secrets, relax Access policy or claim remote migrations were applied just because source integration or local checks succeed.
The backend continues to enforce Access/bearer identity, workspace/project authorization and OAuth consent boundaries.

The maintained integration is on source branch `feat/alchemy-deployment`; it does not establish a production deployment or passing browser E2E acceptance.
Minimal CI only runs `pnpm exec vp run ci` through `.github/workflows/ci.yml`.
Docs generation/builds, plugin checks, browser E2E and deployment jobs are not part of that workflow.
Production/preview deployment automation is deliberately outside the current minimal CI workflow.
Earlier measurements and browser navigation observations on the standalone SSR artifact do not establish all-feature acceptance for this renamed Alchemy-integrated tree.
Final acceptance needs a fresh real Effront RSC/nested SSR artifact held stable while testing cold loads, scope switches, permission failures, URL forms/tabs, Back/Forward, canonical action refresh, saved views, drafts and optimistic behavior.
Attachment verification must cover native ordinary/inline uploads and multipart-inclusive framework limits without a bypass.
Authentication transitions and native file GET/HEAD must preserve credential isolation and private responses.
Do not substitute a renderer, inferred routing behavior or stale legacy E2E success for those observable checks.

## Maintenance rules

Update this record in the same change that adds, alters, removes or absorbs fork-specific behavior, types, tests, configuration or documentation, including already-merged patches.
Keep the immutable fork point unchanged forever; advance the reviewed comparison baseline only after an intentional upstream review, and regenerate the complete tree comparison against that baseline.
Retain purpose, affected areas and operational impact for every divergence category rather than reducing this to the current pull request's diff.
Do not include credentials, temporary artifacts, progress logs or tickets here.
Pull requests for this source fork target `totto2727-org/projektor`, never `TAJD/projektor`.
