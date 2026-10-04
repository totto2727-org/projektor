# Fork differences from upstream

This is the maintained record for [`totto2727-org/projektor`](https://github.com/totto2727-org/projektor), compared with [`TAJD/projektor`](https://github.com/TAJD/projektor).
It covers this source repository only, including the project-creation fix merged in [fork PR #1](https://github.com/totto2727-org/projektor/pull/1), the subsequent client workspace changes in [fork PR #2](https://github.com/totto2727-org/projektor/pull/2), and the independent Effront SSR frontend.
Deployment repositories maintain their own differences separately.

## Comparison revisions

| Revision | Meaning |
| --- | --- |
| [`ab122cbea1bae7efce8abe2345ce07375b9dcd13`](https://github.com/TAJD/projektor/commit/ab122cbea1bae7efce8abe2345ce07375b9dcd13) | Reviewed upstream source baseline. |
| [`290f6644d8ced6d70fe1434437624d59015ff22d`](https://github.com/totto2727-org/projektor/commit/290f6644d8ced6d70fe1434437624d59015ff22d) | Project-creation patch in fork PR #1. |
| [`590ee98ec00b18b34e39d009473d3030bfc39b43`](https://github.com/totto2727-org/projektor/commit/590ee98ec00b18b34e39d009473d3030bfc39b43) | Fork `main` merge of PR #1. |
| [`55d10389929bb8bbccbd70280ce6955a113df4ab`](https://github.com/totto2727-org/projektor/commit/55d10389929bb8bbccbd70280ce6955a113df4ab) | Reviewed frontend snapshot after the full-client scope fix, required project workspace types and static environment retirement. |
| [`2077f7cfc0ba3e4eba130d8157626560d291bd1d`](https://github.com/totto2727-org/projektor/commit/2077f7cfc0ba3e4eba130d8157626560d291bd1d) | Legacy frontend checkpoint with the retained-state hydration fix and complete source divergence record, before introducing the independent SSR app. |

These are immutable reference points, not a claim that upstream `main` remains at the baseline.
The summaries and inventory below cover this checkout, including this record and its maintenance instructions, rather than stopping at the pre-documentation snapshot.
Reproduce the complete current comparison with:

```sh
git diff --name-status ab122cbea1bae7efce8abe2345ce07375b9dcd13 HEAD
git diff ab122cbea1bae7efce8abe2345ce07375b9dcd13 HEAD
```

The legacy source checkpoint is `2077f7cfc0ba3e4eba130d8157626560d291bd1d`, before the independent SSR app.
The SSR architecture and appended inventory describe the source tree containing this record, including its maintained tests and configuration.
This record does not pin a self-referencing final SSR commit SHA or imply a fully validated release.
Before committing, omit `HEAD` to include tracked working-tree changes and inspect `git status --short` for newly added files.
Include untracked SSR source explicitly with `git ls-files --others --exclude-standard apps/ssr`; ignored `node_modules/`, `dist/` and temporary output are not source inventory.

## Intentional source differences

All runtime changes relative to this baseline are in the frontend.
The existing API service, authentication enforcement, database schema, migrations and release implementation are unchanged.
Frontend scope selection supplies context for existing backend authorization, not a replacement for authorization.

| Pattern | Affected area | Difference, purpose and operational impact |
| --- | --- | --- |
| Project creation without workspace identity, PR #1 | `ProjectList.tsx` and `ProjectList.test.tsx` | Discover workspace memberships, offer only owner/admin memberships, auto-select a single eligible workspace, require a choice when there are several, and block loading/error/no-permission submissions. Send the selected workspace through `apiFetch` for `POST /api/projects`, and retain its metadata on the created card. Explicit scope still requires an eligible membership; public viewers cannot create projects. |
| Scoped requests started before identity resolution | `WorkspaceBoundary.tsx`, `project-context.ts`, project root islands and `resolve-project-id.ts` | Resolve project UUID/key/slug and its workspace before mounting request-heavy children. Explicit scope is not overwritten by cached project state. Unknown and ambiguous projects produce an actionable selection/error rather than choosing the first catalog entry. Project/workspace keys remount child state on scope changes. |
| Orphaned loading markup after client tab navigation | `WorkspaceBoundary.tsx` and its hydration regressions | Render the same deterministic loading placeholder for server HTML and the first Preact hydration render, then adopt retained project signals after mounting. Astro ClientRouter replaces page islands while the shared store survives, so choosing the cached branch too early could leave the server loading paragraph beside already-loaded content. This fixes that rendering lifecycle mismatch without resetting shared state, changing the resolver or issuing unscoped requests. Empty issues are not the cause. |
| Optional workspace identity in project catalog types | `project-context.ts`, `board-utils.ts`, `issue-list/types.ts`, `access-gate.ts` | Require `workspace_slug: string`, matching the existing global project response. Represent an unselected project as `ProjectSummary \| null`, not as a fetched project with missing workspace identity. Update typed fixtures and type assertions accordingly. This does not change the API response. |
| Hostname guesses in projectless settings | ConnectAgentGuide, ConnectorManager, GroupManager and TokenManager | Use accessible memberships and explicit URL scope instead of deriving the workspace from a deployment hostname. Synchronize selection across sibling islands and preserve it in the URL. A shared host can serve multiple workspaces. |
| Projectless My Issues requests | `MyIssues.tsx`, issue row types and issue URLs | Query the existing assignee endpoint separately for each accessible membership and aggregate results when no explicit scope is supplied. Keep each row's workspace in grouping and links. Do not add or assume a cross-workspace issues backend endpoint. |
| Navigation and stale catalog identity | `ProjectList.tsx`, `ProjectNav.tsx`, project context and issue lookups | Preserve project UUID and workspace on navigation, distinguish issue/wiki/feedback entity IDs from project hints, refresh discovery for newly created or archived projects, and filter workspace-specific dropdowns after global project discovery. Resolution versions prevent older async results from replacing a newer selection. |
| Scope-free prefetch, links and branding | `issues/view.astro`, `issue-prefetch.ts`, `issue-url.ts`, `brand.ts`, workspace and access helpers | Skip scoped prefetch until a workspace is known, reject mismatched prefetch handoffs, retain scope in pretty issue links, file subresource query parameters and branding. Keep genuine global project/workspace discovery and global access checks global. |
| Build-time workspace injected into shared pages | Astro page sources, `.env.example`, `page-workspace.test.ts` | Remove `PUBLIC_WORKSPACE_SLUG` from all 17 former page consumers and remove the 28 workspace props. Runtime project/membership selection supplies the scope. Issue prefetch uses explicit URL scope or waits for the island. The retired variable has no frontend effect and is not renamed to a test override. |
| Tests masking missing runtime context | `playwright.config.ts`, affected E2E specs and E2E README | Remove the blanket browser tenant header and unused workspace localStorage writes. Retain authentication headers. Test fixture IDs appear explicitly in project/workspace URLs, direct fixture API requests supply their own workspace header, and My Issues assertions identify fixture entities without pretending it is single-workspace. |
| Maintained regression coverage | Changed island/helper tests, new boundary/context/page-workspace tests and `test/setup.ts` | Exercise actual default roots with cold and retained state, scope switches, unknown/ambiguous selections, global discovery, role gates, typed catalog metadata, scoped prefetch and aggregate links. Shared setup resets the store and does not inject workspace identity. Presentation fixtures include realistic metadata. |
| Source maintenance documentation | `AGENTS.md`, generated contributing conventions, E2E README, historical feedback-page examples and this record | Remove obsolete frontend environment instructions and maintain the source fork's own record here. The conventions page mirrors `AGENTS.md` through the existing generator. The historical plan is not an active workspace specification. This record is maintained architecture documentation, not a work log or task ledger. |

The retained `apps/web` frontend continues to call its existing `apiFetch` header boundary.
Global project/workspace discovery, auth, public sharing, global workflow and read-only playbooks retain their existing backend exemptions from workspace context.
Native file GET subresources keep the backend-supported workspace query fallback where a request header cannot be attached.
No change here creates resources, deploys a Worker, applies remote migrations or rotates secrets.

## Independent Effront SSR frontend

`apps/ssr` is a separate React/Effront frontend Worker, using the published `@effront/core`, Vite, Tailwind and Cloudflare adapters at `0.2.0`.
It calls the existing API over HTTP rather than importing backend services, changing authorization, sharing a database binding or combining the two Workers.
The retained Astro/Preact app and existing release/deployment pipeline remain available and are not silently switched to this Worker.
The server resolves request identity and workspace/project context before rendering protected page data.
Client components receive serializable initial DTOs, not a `Request`, API client, environment or shared cross-request signal store.

| Boundary | Affected source | Difference and operational impact |
| --- | --- | --- |
| Rendering and routes | `apps/ssr/src/{effront,entry.effront,entry.workers,page,selection,urls}.ts*` | Effront owns the root document, layouts, matching, client navigation, Back/Forward and server-function refresh. Server page loaders prepare initial content before HTTP streaming, preserve error/denial status codes, and offer native GET project/workspace selection forms instead of a build-time tenant or first-project guess. Legacy paths, entity query IDs and project hints remain separate concepts. |
| Request-local API context | `apps/ssr/src/request.ts`, `apps/ssr/src/server/**`, `apps/ssr/src/http-client-layer.ts` | `RequestApi.get`, `send` and `raw` are pure `HttpClientRequest` builders. `execute` performs execution and transport/status mapping only, returning an Effect `HttpClientResponse`; each domain operation decodes its concrete DTO with `HttpClientResponse.schemaBodyJson` within `Effect.scoped`. There is no HTTP result helper, generic unknown-body decoder or HTTP DTO deduplication/cache. Request caches contain only resolved semantic scopes and prepared views, and are invalidated after mutations, including uncertain outcomes. Provide `HttpClientLive` only at the top-level Effront application and Worker execution boundaries, never inside a domain operation. Forward the actual Access assertion/cookie or bearer credential only to the fixed trusted API origin. Resolve project metadata from the authenticated global catalog, check explicit workspace membership and attach `X-Workspace-Slug` to scoped requests. Do not reuse browser-global caches or run a nested Effect runtime inside domain loaders. Web Request/Response conversion is restricted to the Worker/framework boundary and required stream/signal interoperability. |
| Forms, mutations and interaction queries | `apps/ssr/src/features/**/{actions,form-schemas,input-schemas}.ts`, `apps/ssr/src/client/{functions,runtime}.ts*`, `apps/ssr/src/function-result.ts` | Use native GET filters, URL tabs and native `useActionState` actions for simple forms. Stateful forms use TanStack Form with Effect `Schema.toStandardSchemaV1`; the server validates inputs independently. Declare individual literal `ServerFn.make` operations with their own input schema, authorized semantic scope and fixed API operation. Public Effront query functions serve interaction-specific reads, not page bootstrap. There is no generic browser HTTP dispatcher, mutation factory, custom router, refresh event bus or render-ID protocol. Effront owns the mutation response and refreshed canonical server tree. Tiny transient controls, unsaved drafts and `useOptimistic` framework overlays are not replacement canonical stores. `function-result.ts` describes typed UI action outcomes, not an HTTP response decoding helper. |
| Attachment transport | `apps/ssr/src/{attachments,attachment-actions}.ts`, `apps/ssr/src/components/AttachmentUpload.tsx`, `apps/ssr/src/features/wiki/WikiPageClient.tsx` | Ordinary attachment upload is a native form using `useActionState(uploadAttachment)`. Wiki paste/drop separately calls the literal `uploadInlineImage` ServerFn so insertion can preserve the editor draft/cursor. Both use Effront transport and its current 10 MiB total request-body cap, including multipart overhead. The API's 50 MiB file policy is unchanged but is not fully accessible through that framework cap. Framework request-size bypasses are prohibited: the former custom upload routes, attachment-navigation handler and client upload helper have been deleted, with no 303 attachment-upload path or browser upload proxy remaining. Each ServerFn authorizes the workspace, forwards only the fixed file-upload operation with Effect HTTP and concretely decodes the response in a scoped operation. An uncertain upload is not automatically retried. |
| Authentication document boundary | `apps/ssr/src/session-navigation.ts`, Worker entry and account-menu forms | Login, session refresh and logout use native same-origin POST forms rather than intercepted Flight links. The small frontend handler validates a bounded form and returns a 303 to the existing login or Access logout URL. Native form navigation discards the previous identity's application runtime without a custom router listener or private Effront API. Local return paths retain project/workspace queries. The API still owns authentication. |
| Shared presentation | `apps/ssr/src/brand.ts`, `apps/ssr/src/components/**`, `apps/ssr/src/styles/app.css` | Adapt the existing shell, navigation and UI component contracts to React. Reuse the retained CSS tokens/global stylesheet and public fonts/assets as build inputs, not the Preact renderer. Load deployment and selected-workspace branding on the server, emitting names, favicon and color variables before paint without a cross-workspace browser cache. Branding remains cosmetic and optional, unlike protected page data. Keep tenant identity out of cosmetic localStorage preferences. Add a skip link, keyboard/focus behavior and responsive navigation without introducing another router. |
| Page features and canonical state | `apps/ssr/src/features/**` | Port all 19 legacy page-source surfaces listed below, including dynamic aliases/fallbacks, with the original UI, CSS and control trees rather than substitute interfaces. Server route families own initial API load plans for Projects/Overview, Issues/My Issues/Epics, Wiki, Feedback, Sprints/Metrics, Groups/Tokens/Connectors and public Share/Help. SSR props remain canonical across refresh and navigation. Large-content tabs, view modes and filters use path/query navigation and native GET forms. Client state is limited to tiny transient controls, unsaved drafts and framework `useOptimistic` overlays. Public Share does not request membership discovery. Named issue views use user/workspace/project-scoped sessionStorage per browser tab, never entity-bearing cosmetic localStorage; applying a view explicitly navigates to canonical URL filters. |
| Tooling and dependencies | `justfile`, `apps/ssr/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,wrangler.jsonc}`, `pnpm-lock.yaml`, `biome.json` | Centralize new install/build/check/local-preview/dry-run tasks in `justfile`, pin the Effront-compatible local Vite+ toolchain, and include new SSR source in Biome checks. The app is workspace-internal and does not become another version source. Generated RSC, client and nested SSR bundles live in ignored `dist/`, not vendored source. |

The port retains the original issue UI limits: custom-field editing is story-points-only, issue hierarchy shows the parent badge and children rather than adding a new reparent control, and backlog drag ordering is local presentation state, not persisted backend ordering.
These limits are not missing newly promised features.
Issue response decoding respects the existing endpoint contracts: the list-only joined `assignee_name` alias may be absent from an issue-detail DTO.
The concrete issue schema permits that omission and pure presentation normalization supplies `null`, while malformed present values still fail decoding.
Maintained loader regressions in `apps/ssr/src/features/issues/loaders.test.tsx` cover the actual detail wire shape and invalid alias values without changing the API or broadening required identity fields.
The backend, schema and migrations are unchanged, and the protected root `README.md` and philosophy documents are not modified by this SSR addition.
The Effront dependencies are pinned to the current maximum core release `0.2.0`; the integration uses verified published APIs, not private framework hooks.

### Independent build and deployment boundary

Run the new task entry points from this source repository:

```sh
just ssr-install
just ssr-lint
just ssr-format
just ssr-check
just ssr-build
just ssr-preview
just ssr-deploy-dry-run
```

The source Vite configuration accepts `EFFRONT_WRANGLER_CONFIG` through the adapter's public `configPath` option; when absent, it uses the checked-in app configuration.
This is a source-owned configuration boundary, not a specification of any deployment repository's files or procedures.
The generated Worker configuration is `apps/ssr/dist/rsc/wrangler.json`, including its browser assets and nested SSR modules.
Start a fresh Wrangler preview from this generated configuration after building instead of hot-rebuilding while an acceptance session is using changing chunk filenames.
The checked-in frontend `wrangler.jsonc` defaults `API_BASE` to `http://127.0.0.1:8792` for a separately running local API.
For production, replace it with the existing API's trusted HTTPS origin and assign the frontend its own Worker route/domain.
`API_BASE` is transport configuration, not workspace selection, and must not point back to the frontend's own gateway.

Production Access configuration must allow the frontend's actual user credential to be accepted by the API and its edge policy, including the configured audience and hostname/cookie topology.
Do not replace that prerequisite with a privileged shared token, a spoofed user header or relaxed backend verification.
There is no generic browser API proxy.
The fixed-origin gateway is exposed only for native `/api/files/*` GET/HEAD subresources and the GET `/auth/login` document boundary; `/auth/session` uses its separate native session-navigation handler.
The gateway deliberately does not follow arbitrary API redirects with user credentials.
The existing authenticated `/auth/login` redirect is forwarded only as a safe same-origin document destination.
Dynamic HTML and Flight responses remain private and non-cacheable by shared HTTP caches.
Effront manages its in-memory history responses and invalidates them through server-function refresh; authentication/document transitions must not be treated as permission to share those responses between users.
The retained frontend's old service worker does not precache HTML or install a navigation fallback.
This addition does not deploy either Worker, mutate remote resources, apply migrations or rotate secrets.

### Acceptance requirements and evidence boundary

The architecture and source inventory below are not evidence of a newly completed final all-feature browser E2E run.
The coordinating root observed bounded navigation acceptance on a held official-build artifact: 52 history checkpoints across two desktop rounds and two mobile rounds passed URL, content, active-navigation and workspace/project-scope checks, without loading placeholders, errors or client API bootstrap.
The reported layout measurements distinguish formal document CLS from all-shift diagnostics:

| Measurement | SSR desktop | Legacy desktop | SSR mobile | Legacy mobile |
| --- | --- | --- | --- | --- |
| Formal document CLS | 0 | 0.0559877566 | 0 | 0 |
| All-shift diagnostics | 0 | 0.155610469 | 0.105702927 | 0.288410722 |

These observations establish only the measured navigation/layout behavior on that held artifact, not every feature or mutation in the subsequently corrected working tree.
The project form contract requires blank descriptions to be strings, not unsupported `null` values.
The source actions now send an empty string for blank create/clear-description inputs, and the shared Effect/Standard Schema project-key validator requires the API's leading letter.
`apps/ssr/src/features/projects/actions.test.ts` maintains three regressions for blank creation, clearing descriptions and rejecting leading-digit keys before transport, using the unchanged API Zod schemas for payload-contract checks.
The existence and source inspection of those regressions are not a claim of a new final test run.
Final fresh-build form/entity acceptance is not yet established for this source snapshot.
Acceptance requires a fresh official Effront RSC/nested SSR Worker artifact incorporating these corrections, held stable during browser verification rather than a substituted renderer or a changing hot rebuild.
Required QA is to use the real built Effront RSC/nested SSR Worker with the existing API, compare all 19 legacy surfaces and their original control trees/CSS, and observe cold-load identity resolution, workspace/project switches, permission failures, native GET filters, URL tabs and Back/Forward, action-driven canonical refresh, scoped saved views and draft/optimistic behavior.
Attachment QA must observe both native `uploadAttachment` and inline `uploadInlineImage`, multipart-inclusive 10 MiB framework rejection without a bypass, and unchanged backend policy.
Authentication transitions and native file GET/HEAD must be checked without exposing a generic API proxy or sharing protected responses between users.
The task recipes are reproducible validation entry points, not a claim that builds, tests, dry runs or final E2E were executed for this documentation snapshot.

## Retained workspace-neutral Astro page delivery

The following table describes the retained `apps/web` app, not the new SSR Worker.
Astro uses `output: 'static'`, without an Astro SSR adapter.
Static describes the HTML shell, not the selected workspace or data loaded by hydrated Preact islands.
There are 19 page source files: 16 emit concrete HTML shells and three have empty `getStaticPaths()` and emit no per-entity production HTML.
The configured `/projects` redirect is additional build output, not a twentieth page source.

| Source under `apps/web/src/pages/` | Production delivery | Runtime context, and why a build-time workspace is unnecessary |
| --- | --- | --- |
| `index.astro` | Static Projects shell at `/` | Global project catalog. Creation selects an eligible workspace membership. A fixed tenant would restrict the global catalog. |
| `projects/view.astro` | Static Overview shell, also served for Worker `/projects/view/:slug` fallback | The selected project's metadata supplies the workspace. Ambiguity requires selection. |
| `issues.astro` | Static Issues shell | Runtime project/workspace context gates scoped requests. The same shell serves different contexts. |
| `issues/view.astro` | Static issue-detail shell, also used by pretty issue Worker fallback | Entity UUID or pretty reference plus runtime scope. Inline prefetch requires explicit URL workspace. |
| `sprints.astro` | Static Sprints shell | Selected project metadata supplies its workspace. |
| `epics.astro` | Static Epics shell | Selected project metadata supplies its workspace. |
| `metrics.astro` | Static Metrics shell | Selected project metadata supplies its workspace. |
| `feedback.astro` | Static Feedback shell | Runtime project/membership boundary scopes the source list. |
| `feedback/view.astro` | Static detail shell, also used for `/feedback/:sourceId` fallback | Source identity plus runtime project/membership scope. A source ID is not a project ID. |
| `feedback/[sourceId].astro` | Empty static paths, development template. Production falls back to `feedback/view.astro`. | Runtime source identity and scope, without per-workspace generated HTML. |
| `my-issues.astro` | Static My Issues shell | Accessible memberships are queried separately and aggregated. A fixed tenant would incorrectly narrow this view. |
| `settings/groups.astro` | Static Groups shell | Membership selection, explicit URL workspace or current project inheritance. |
| `settings/tokens.astro` | Static Tokens/Connectors/Agent setup shell | Sibling membership boundaries share runtime selection and URL scope. |
| `wiki.astro` | Static Wiki shell with existing Worker legacy redirect helper | Runtime project/membership context scopes API calls. |
| `wiki/view.astro` | Static Wiki detail fallback shell | URL wiki slug and runtime project/membership context. |
| `wiki/[slug].astro` | Empty static paths, development template. Production falls back to `wiki/view.astro`. | Runtime scope. Worker metadata is a separate request-time enhancement, described below. |
| `projects/[projectSlug]/issues/[issueNumber]/[titleSlug].astro` | Empty static paths, development template. Production falls back to `issues/view.astro`. | Pretty reference supplies project/issue hints, not a build-time tenant. |
| `help.astro` | Static documentation HTML | No page-specific workspace data. It never used the retired setting. |
| `share/view.astro` | Static public-share shell, also served for `/share/:token` | Public token scope, not membership selection. It never used the retired setting. |

None of these pages requires a fixed public workspace environment value.
The former value was a single-workspace local/default convenience, not a static-generation requirement, and could override runtime identity.
Tests use generated `E2EContext` fixture identity and explicitly test-prefixed controls such as `E2E_BASE_URL` instead.

The unchanged wiki Worker can inject authenticated title/Open Graph metadata at request time.
Its server scope resolution is header, opt-in subdomain routing, then `DEFAULT_WORKSPACE_SLUG`; it does not read the frontend `workspace` query parameter.
An unresolved or unauthorized metadata lookup keeps the ordinary static shell.
This is not Astro SSR and does not justify a build-time browser tenant.
The server default and routing configuration remain unchanged.

The human-authored root `README.md` still has an obsolete local-setup comment naming the retired variable.
Repository instructions prohibit agent edits to that file, so that comment is not treated as an active configuration contract.
The editable environment example, instructions, contributing conventions, E2E guide and historical page examples are corrected.

Implementation references: [Astro configuration](../apps/web/astro.config.mjs), [pages](../apps/web/src/pages), [Worker fallbacks](../apps/api/src/index.ts) and [wiki metadata scope](../apps/api/src/lib/wiki-ssr.ts).

## Complete changed-path inventory

Paths are relative to this repository and cover the full tree comparison, including tests and documentation, not just runtime files.
`M` means modified and `A` means added relative to the reviewed upstream baseline.
The first block preserves the legacy inventory and PR history; the second appends the exact SSR source paths and additional root configuration changes.
Together they cover the tracked comparison against `ab122cbea1bae7efce8abe2345ce07375b9dcd13` plus untracked source, not an obsolete legacy-only path count.
This inventory must be adjusted when a later change alters the set of differing paths.

```text
M AGENTS.md
M apps/docs/src/content/docs/contributing/conventions.md
M apps/web/.env.example
M apps/web/e2e/README.md
M apps/web/e2e/board.spec.ts
M apps/web/e2e/create-issue.spec.ts
M apps/web/e2e/editor-freeze.spec.ts
M apps/web/e2e/epics.spec.ts
M apps/web/e2e/groups-flow.spec.ts
M apps/web/e2e/issue-attachments.spec.ts
M apps/web/e2e/mobile-issue-list.spec.ts
M apps/web/e2e/my-issues.spec.ts
M apps/web/e2e/settings-tokens.spec.ts
M apps/web/e2e/sprint.spec.ts
M apps/web/e2e/wiki-flow.spec.ts
M apps/web/playwright.config.ts
M apps/web/src/islands/ConnectAgentGuide.test.tsx
M apps/web/src/islands/ConnectAgentGuide.tsx
M apps/web/src/islands/ConnectorManager.tsx
M apps/web/src/islands/EpicList.test.tsx
M apps/web/src/islands/EpicList.tsx
M apps/web/src/islands/FeedbackSourceDetail.test.tsx
M apps/web/src/islands/FeedbackSourceDetail.tsx
M apps/web/src/islands/FeedbackSourceGrid.tsx
M apps/web/src/islands/GroupManager.tsx
M apps/web/src/islands/IssueDetail.test.tsx
M apps/web/src/islands/IssueDetail.tsx
M apps/web/src/islands/IssueList.test.tsx
M apps/web/src/islands/IssueList.tsx
M apps/web/src/islands/MetricsDashboard.test.tsx
M apps/web/src/islands/MetricsDashboard.tsx
M apps/web/src/islands/MyIssues.test.tsx
M apps/web/src/islands/MyIssues.tsx
M apps/web/src/islands/ProjectLanding.test.tsx
M apps/web/src/islands/ProjectLanding.tsx
M apps/web/src/islands/ProjectList.test.tsx
M apps/web/src/islands/ProjectList.tsx
M apps/web/src/islands/ProjectNav.test.tsx
M apps/web/src/islands/ProjectNav.tsx
M apps/web/src/islands/SprintManager.test.tsx
M apps/web/src/islands/SprintManager.tsx
M apps/web/src/islands/TokenManager.test.tsx
M apps/web/src/islands/TokenManager.tsx
M apps/web/src/islands/WikiPage.test.tsx
M apps/web/src/islands/WikiPage.tsx
A apps/web/src/islands/WorkspaceBoundary.test.tsx
A apps/web/src/islands/WorkspaceBoundary.tsx
M apps/web/src/islands/board-utils.ts
M apps/web/src/islands/issue-list/CreateIssueModal.test.tsx
M apps/web/src/islands/issue-list/derive.test.ts
M apps/web/src/islands/issue-list/types.ts
M apps/web/src/islands/issue-list/useCreateIssueModal.test.tsx
M apps/web/src/islands/issue-list/useIssueLookups.ts
A apps/web/src/lib/project-context.test.ts
M apps/web/src/lib/project-context.ts
M apps/web/src/pages/epics.astro
M apps/web/src/pages/feedback.astro
M apps/web/src/pages/feedback/[sourceId].astro
M apps/web/src/pages/feedback/view.astro
M apps/web/src/pages/index.astro
M apps/web/src/pages/issues.astro
M apps/web/src/pages/issues/view.astro
M apps/web/src/pages/metrics.astro
M apps/web/src/pages/my-issues.astro
M apps/web/src/pages/projects/[projectSlug]/issues/[issueNumber]/[titleSlug].astro
M apps/web/src/pages/projects/view.astro
M apps/web/src/pages/settings/groups.astro
M apps/web/src/pages/settings/tokens.astro
M apps/web/src/pages/sprints.astro
M apps/web/src/pages/wiki.astro
M apps/web/src/pages/wiki/[slug].astro
M apps/web/src/pages/wiki/view.astro
M apps/web/src/test/setup.ts
M apps/web/src/utils/access-gate.ts
M apps/web/src/utils/brand.test.ts
M apps/web/src/utils/brand.ts
M apps/web/src/utils/issue-prefetch.test.ts
M apps/web/src/utils/issue-prefetch.ts
M apps/web/src/utils/issue-url.ts
A apps/web/src/utils/page-workspace.test.ts
M apps/web/src/utils/resolve-project-id.test.ts
M apps/web/src/utils/resolve-project-id.ts
M apps/web/src/utils/workspace.test.ts
M apps/web/src/utils/workspace.ts
M docs/superpowers/plans/2026-07-26-feedback-page-layout-plan.md
A docs/upstream-differences.md
```

### SSR source inventory supplement

This exact path snapshot supplements the retained legacy block above and includes new source, maintained tests, tooling, dependency lock and formatter configuration.
It describes the source tree containing this record; generated bundles and ignored dependency/temporary directories are excluded.

```text
M biome.json
M pnpm-lock.yaml
A justfile
A apps/ssr/package.json
A apps/ssr/src/attachment-actions.test.ts
A apps/ssr/src/attachment-actions.ts
A apps/ssr/src/attachments.ts
A apps/ssr/src/brand.test.ts
A apps/ssr/src/brand.ts
A apps/ssr/src/client/functions.ts
A apps/ssr/src/client/runtime.test.tsx
A apps/ssr/src/client/runtime.tsx
A apps/ssr/src/components/AttachmentUpload.tsx
A apps/ssr/src/components/FormErrors.test.tsx
A apps/ssr/src/components/FormErrors.tsx
A apps/ssr/src/components/ProjectNav.tsx
A apps/ssr/src/components/Shell.tsx
A apps/ssr/src/components/ViewErrorBoundary.tsx
A apps/ssr/src/components/ui/Badge.tsx
A apps/ssr/src/components/ui/Button.tsx
A apps/ssr/src/components/ui/Card.tsx
A apps/ssr/src/components/ui/Dialog.tsx
A apps/ssr/src/components/ui/EmptyState.tsx
A apps/ssr/src/components/ui/Field.tsx
A apps/ssr/src/components/ui/Input.tsx
A apps/ssr/src/components/ui/Popover.tsx
A apps/ssr/src/components/ui/Select.tsx
A apps/ssr/src/components/ui/Table.tsx
A apps/ssr/src/effront.ts
A apps/ssr/src/entry.effront.tsx
A apps/ssr/src/entry.workers.ts
A apps/ssr/src/features/feedback/FeedbackDetailClient.tsx
A apps/ssr/src/features/feedback/FeedbackGridClient.tsx
A apps/ssr/src/features/feedback/FeedbackList.tsx
A apps/ssr/src/features/feedback/FeedbackSourceDetail.tsx
A apps/ssr/src/features/feedback/FeedbackSourceGrid.tsx
A apps/ssr/src/features/feedback/FeedbackSourceSettings.tsx
A apps/ssr/src/features/feedback/FeedbackSummary.tsx
A apps/ssr/src/features/feedback/NewSourceModal.tsx
A apps/ssr/src/features/feedback/actions.ts
A apps/ssr/src/features/feedback/feedback-actions.test.ts
A apps/ssr/src/features/feedback/feedback-client.test.tsx
A apps/ssr/src/features/feedback/feedback.test.tsx
A apps/ssr/src/features/feedback/schemas.ts
A apps/ssr/src/features/feedback/server.tsx
A apps/ssr/src/features/help/HelpPage.tsx
A apps/ssr/src/features/issues/action-schemas.ts
A apps/ssr/src/features/issues/actions.test.ts
A apps/ssr/src/features/issues/actions.ts
A apps/ssr/src/features/issues/forms.test.tsx
A apps/ssr/src/features/issues/forms.ts
A apps/ssr/src/features/issues/index.ts
A apps/ssr/src/features/issues/legacy/EpicList.tsx
A apps/ssr/src/features/issues/legacy/IssueDetail.tsx
A apps/ssr/src/features/issues/legacy/IssueDetailParts.tsx
A apps/ssr/src/features/issues/legacy/IssueList-helpers.ts
A apps/ssr/src/features/issues/legacy/IssueList.tsx
A apps/ssr/src/features/issues/legacy/LazyMarkdownEditor.tsx
A apps/ssr/src/features/issues/legacy/MyIssues.tsx
A apps/ssr/src/features/issues/legacy/board-utils.ts
A apps/ssr/src/features/issues/legacy/issue-detail-helpers.ts
A apps/ssr/src/features/issues/legacy/issue-list/BacklogView.tsx
A apps/ssr/src/features/issues/legacy/issue-list/BoardView.test.tsx
A apps/ssr/src/features/issues/legacy/issue-list/BoardView.tsx
A apps/ssr/src/features/issues/legacy/issue-list/BulkActions.tsx
A apps/ssr/src/features/issues/legacy/issue-list/CreateIssueModal.test.tsx
A apps/ssr/src/features/issues/legacy/issue-list/CreateIssueModal.tsx
A apps/ssr/src/features/issues/legacy/issue-list/FiltersPopover.test.tsx
A apps/ssr/src/features/issues/legacy/issue-list/FiltersPopover.tsx
A apps/ssr/src/features/issues/legacy/issue-list/HeaderRow.tsx
A apps/ssr/src/features/issues/legacy/issue-list/IssueListLayout.tsx
A apps/ssr/src/features/issues/legacy/issue-list/ListSection.tsx
A apps/ssr/src/features/issues/legacy/issue-list/MainContent.tsx
A apps/ssr/src/features/issues/legacy/issue-list/PageNavigation.tsx
A apps/ssr/src/features/issues/legacy/issue-list/SavedViewsControl.test.tsx
A apps/ssr/src/features/issues/legacy/issue-list/SavedViewsControl.tsx
A apps/ssr/src/features/issues/legacy/issue-list/SearchBox.tsx
A apps/ssr/src/features/issues/legacy/issue-list/SearchResultsSection.test.tsx
A apps/ssr/src/features/issues/legacy/issue-list/SearchResultsSection.tsx
A apps/ssr/src/features/issues/legacy/issue-list/SprintBannerSection.tsx
A apps/ssr/src/features/issues/legacy/issue-list/Toolbar.tsx
A apps/ssr/src/features/issues/legacy/issue-list/derive.test.ts
A apps/ssr/src/features/issues/legacy/issue-list/derive.ts
A apps/ssr/src/features/issues/legacy/issue-list/issue-render-helpers.test.ts
A apps/ssr/src/features/issues/legacy/issue-list/issue-render-helpers.tsx
A apps/ssr/src/features/issues/legacy/issue-list/types-view.ts
A apps/ssr/src/features/issues/legacy/issue-list/types.ts
A apps/ssr/src/features/issues/legacy/issue-list/useCreateIssueModal.test.tsx
A apps/ssr/src/features/issues/legacy/issue-list/useCreateIssueModal.ts
A apps/ssr/src/features/issues/legacy/issue-list/useFilterUrlSync.test.ts
A apps/ssr/src/features/issues/legacy/issue-list/useFilterUrlSync.ts
A apps/ssr/src/features/issues/legacy/issue-list/useIssueFilters.ts
A apps/ssr/src/features/issues/legacy/issue-list/useIssueListData.ts
A apps/ssr/src/features/issues/legacy/issue-list/useIssueLookups.ts
A apps/ssr/src/features/issues/legacy/issue-list/useIssueMutations.ts
A apps/ssr/src/features/issues/legacy/issue-list/useIssueSearch.ts
A apps/ssr/src/features/issues/legacy/issue-list/useSavedViews.ts
A apps/ssr/src/features/issues/legacy/saved-views.ts
A apps/ssr/src/features/issues/lib/issue-ref.ts
A apps/ssr/src/features/issues/lib/slugify.ts
A apps/ssr/src/features/issues/lib/status.ts
A apps/ssr/src/features/issues/lib/story-points.ts
A apps/ssr/src/features/issues/loaders.test.tsx
A apps/ssr/src/features/issues/query.ts
A apps/ssr/src/features/issues/refresh.test.tsx
A apps/ssr/src/features/issues/server.test.ts
A apps/ssr/src/features/issues/server.tsx
A apps/ssr/src/features/issues/test/browser.ts
A apps/ssr/src/features/issues/test/fixtures.ts
A apps/ssr/src/features/issues/test/viewport.ts
A apps/ssr/src/features/issues/types.ts
A apps/ssr/src/features/issues/utils/date-input.ts
A apps/ssr/src/features/issues/utils/drafts.ts
A apps/ssr/src/features/issues/utils/issue-url.ts
A apps/ssr/src/features/issues/utils/issue-utils.ts
A apps/ssr/src/features/issues/utils/markdown.ts
A apps/ssr/src/features/issues/utils/navigation.ts
A apps/ssr/src/features/issues/utils/query-fields.ts
A apps/ssr/src/features/issues/utils/use-media-query.ts
A apps/ssr/src/features/issues/utils/use-unsaved-unload-guard.ts
A apps/ssr/src/features/issues/views/EpicsPage.tsx
A apps/ssr/src/features/issues/views/IssueDetailPage.tsx
A apps/ssr/src/features/issues/views/IssuesPage.tsx
A apps/ssr/src/features/issues/views/MyIssuesPage.tsx
A apps/ssr/src/features/issues/views/shared.tsx
A apps/ssr/src/features/planning/CodeHeatmap.tsx
A apps/ssr/src/features/planning/MetricHelp.tsx
A apps/ssr/src/features/planning/MetricsDashboard.test.tsx
A apps/ssr/src/features/planning/MetricsDashboard.tsx
A apps/ssr/src/features/planning/SprintManager.test.tsx
A apps/ssr/src/features/planning/SprintManager.tsx
A apps/ssr/src/features/planning/UplotChart.tsx
A apps/ssr/src/features/planning/action-test-fixture.ts
A apps/ssr/src/features/planning/actions.test.ts
A apps/ssr/src/features/planning/actions.ts
A apps/ssr/src/features/planning/flow-charts.tsx
A apps/ssr/src/features/planning/form-ui.tsx
A apps/ssr/src/features/planning/helpers.ts
A apps/ssr/src/features/planning/input-schemas.ts
A apps/ssr/src/features/planning/metric-definitions.ts
A apps/ssr/src/features/planning/schemas.ts
A apps/ssr/src/features/planning/server.test.tsx
A apps/ssr/src/features/planning/server.tsx
A apps/ssr/src/features/planning/types.ts
A apps/ssr/src/features/planning/widgets.tsx
A apps/ssr/src/features/projects/ProjectFlowCharts.tsx
A apps/ssr/src/features/projects/ProjectLanding.tsx
A apps/ssr/src/features/projects/ProjectList.tsx
A apps/ssr/src/features/projects/ProjectRefresh.test.tsx
A apps/ssr/src/features/projects/actions.test.ts
A apps/ssr/src/features/projects/actions.ts
A apps/ssr/src/features/projects/schemas.ts
A apps/ssr/src/features/projects/server.tsx
A apps/ssr/src/features/settings/ConnectAgentGuide.tsx
A apps/ssr/src/features/settings/ConnectorManager.tsx
A apps/ssr/src/features/settings/GroupManager.tsx
A apps/ssr/src/features/settings/TokenManager.tsx
A apps/ssr/src/features/settings/actions.test.ts
A apps/ssr/src/features/settings/actions.ts
A apps/ssr/src/features/settings/input-schemas.ts
A apps/ssr/src/features/settings/schemas.ts
A apps/ssr/src/features/settings/server.test.tsx
A apps/ssr/src/features/settings/server.tsx
A apps/ssr/src/features/settings/settings.test.tsx
A apps/ssr/src/features/settings/types.ts
A apps/ssr/src/features/settings/widgets.tsx
A apps/ssr/src/features/share/ShareView.tsx
A apps/ssr/src/features/share/brand.ts
A apps/ssr/src/features/share/server.tsx
A apps/ssr/src/features/share/share.test.tsx
A apps/ssr/src/features/wiki/LazyMarkdownEditor.tsx
A apps/ssr/src/features/wiki/MarkdownEditor.tsx
A apps/ssr/src/features/wiki/WikiPageClient.tsx
A apps/ssr/src/features/wiki/actions.ts
A apps/ssr/src/features/wiki/form-schemas.ts
A apps/ssr/src/features/wiki/headings.ts
A apps/ssr/src/features/wiki/markdown.tsx
A apps/ssr/src/features/wiki/navigation.ts
A apps/ssr/src/features/wiki/render-markdown.ts
A apps/ssr/src/features/wiki/schemas.ts
A apps/ssr/src/features/wiki/server.tsx
A apps/ssr/src/features/wiki/test-api.ts
A apps/ssr/src/features/wiki/wiki-actions.test.ts
A apps/ssr/src/features/wiki/wiki-client.test.tsx
A apps/ssr/src/features/wiki/wiki-server.test.tsx
A apps/ssr/src/features/wiki/wiki.test.tsx
A apps/ssr/src/function-result.ts
A apps/ssr/src/gateway.test.ts
A apps/ssr/src/gateway.ts
A apps/ssr/src/http-client-layer.ts
A apps/ssr/src/page.tsx
A apps/ssr/src/request.test.ts
A apps/ssr/src/request.ts
A apps/ssr/src/selection.tsx
A apps/ssr/src/server/api-client.test.ts
A apps/ssr/src/server/api-client.ts
A apps/ssr/src/server/errors.ts
A apps/ssr/src/server/function-context.test.ts
A apps/ssr/src/server/function-context.ts
A apps/ssr/src/server/index.ts
A apps/ssr/src/server/request-context.test.ts
A apps/ssr/src/server/request-context.ts
A apps/ssr/src/session-navigation.test.ts
A apps/ssr/src/session-navigation.ts
A apps/ssr/src/styles/app.css
A apps/ssr/src/urls.ts
A apps/ssr/tsconfig.json
A apps/ssr/vite.config.ts
A apps/ssr/vitest.config.ts
A apps/ssr/wrangler.jsonc
```

## Maintenance rule

Update this record in the same change whenever fork-specific behavior, types, tests, configuration or documentation is added, changed, removed or absorbed upstream.
Record the purpose, affected areas, operational impact and reviewed upstream revision, including changes already merged into fork `main`.
When incorporating upstream, update the baseline deliberately and compare complete trees, not only the current pull request or a merge-base diff.
Keep this source record in this repository and linked from `AGENTS.md`; generated conventions mirror that entry point.
Do not place source-change summaries in a deployment example or use this record for progress logs, temporary artifacts, credentials or task tracking.
Pull requests for fork work target `totto2727-org/projektor`, never `TAJD/projektor`.
