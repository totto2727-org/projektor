---
title: "Contributor conventions"
description: "Architecture contract and conventions for working on the Projektor codebase."
sidebar:
  order: 1
---
> **Note:** this page is generated from [`AGENTS.md`](https://github.com/TAJD/projektor/blob/main/AGENTS.md)
> in the repo root by `scripts/gen-conventions-page.ts`. Edit that file, not this page — it is
> overwritten on every generate.

Guidance for AI agents (and humans) working **on** the projektor codebase.
Read this before making changes — it captures conventions that aren't obvious from the code alone.

> Portable source of truth across agent tools (Claude Code, Codex, Cursor, …). `CLAUDE.md` points here.

## What projektor is

A project management tool deployed on Cloudflare, combining AI-native design with tried-and-tested principles.

Design principles

1. Fast and lightweight.
2. Serverless, built on Cloudflare resources.

Implementation details:

- When implementing a feature or fixing a bug, always add a test that confirms the behaviour.
- **Runtime:** Hono on Cloudflare Workers
- **Data:** D1 (SQLite) for relational data, KV for caching (Access certs, user-by-email), R2 for file attachments
- **Schema:** Drizzle is the schema and primary query layer; raw `DB.prepare` remains in the auth/workspace middleware hot path, the dev bootstrap, and a handful of service queries (FTS, counters) where hand-written SQL is clearer.
- **Monorepo:** pnpm workspaces with VitePlus. `apps/api` contains the Hono API Worker, `apps/web` contains the React/Effront SSR frontend, and `apps/docs` remains the Astro documentation site. Shared code lives in `packages/*` and `plugins/*`.
- **Shared reads:** `@projektor/data-services` contains pure, server-only Effect-based D1 read queries reused by API services and Web server loaders. It owns neither authentication/authorization policy nor UI/API response shaping. Each app authorizes its caller, supplies trusted visibility predicates and maps query results/errors at its own boundary. Mutations remain API operations over the native Worker service binding, never direct Web DB writes or browser API fetches.
- **Deploy:** this fork owns one Alchemy stack in root `alchemy.run.ts`, containing the API and Effront frontend as separate logical applications. Operate it from this source repository with `just dev`, `just plan`, and `just deploy`, not an example deployment repository or a standalone Wrangler configuration. The Effront frontend was moved from `apps/ssr` to `apps/web`, replacing the former Astro/Preact app. Alchemy is pinned to `2.0.0-beta.79` and the official Effront packages to `0.2.0`.
- **Existing production resources:** preserve API Worker `projektor`, frontend Worker `projektor-frontend`, D1/KV/R2 identities and Access configuration in `infra/config.ts`. Bind existing storage IDs through public `Worker.bind` without declaring production storage lifecycle ownership. Preserve the deployed `RATE_LIMITER`/`RateLimiter` binding, leaving `WorkspaceHub` unbound and not replaying old migrations. Supply the existing `JWT_SECRET` through the deployment environment, never generate a production replacement. Production plan/deploy require `PROJEKTOR_ACCESS_CONFIRMED=true` after operator review of existing hostname protection. This is not a remote Access check. `plan` is not a build, and Alchemy CLI profile authentication is required even for local commands.
- **Runtime/deployment split:** use public Alchemy Worker/runtime APIs. Root stack preflight checks the resolved production account, Access confirmation and preserved secret before Worker registration. Runtime-phase Worker props resolve symbolic identity/bindings without deployment configuration or child resource declarations. API and Web share `LocalDatabase` in dev and the existing external production D1 ID; only the API binds KV/R2.

## Coordination model (read this first)

Projektor expects multiple agents to work the same workspace concurrently. Before
editing anything:

- **Claim before editing.** File claims (`claim_files`) are path-level — they stop two
  agents editing the same files. Matching is **exact string equality**, not globs:
  claiming `src/` reserves nothing under `src/`, so name concrete paths and name them the
  same way the rest of the fleet does. Issue leases (`claim_issue`) are work-item-level —
  they stop two agents picking up the same ticket. The two are independent; you need both.
- **Your session goes stale if you stop heartbeating.** Liveness is heartbeat-based:
  `ACTIVE_TTL` in `apps/api/src/services/agents.ts` (mirrored as `SESSION_TTL_SECONDS` in
  `apps/api/src/services/issue-leases.ts`) is **120 seconds**. Register, then go quiet for
  two minutes without a `heartbeat_agent` call, and your session goes stale — you must
  heartbeat again before you can claim.
- **Both tiers self-heal.** An issue lease or file claim held by a stale session is
  reclaimed by the next claimer in the same call (`release_reason: "expired"`). Still call
  `release_files` and `end_agent` when you finish: reclaim only happens when someone else
  wants the path, so until then your claims sit there looking held, and a clean exit is
  what distinguishes you from a crash in the health data. A claim with no `agent_id` has no
  heartbeat to judge and is never auto-reclaimed — `force` is the only way past it.
- **There's a per-project cap on concurrently leased issues** —
  `DEFAULT_AGENT_WIP_LIMIT = 3` in `apps/api/src/services/issue-leases.ts`,
  overridable per project via `projects.agent_wip_limit`. It's admission control on
  the backlog, not a rate limit: it bounds how much work can be in flight at once,
  not how fast you can ask.
- **A refused claim tells you who to talk to.** Rejection is all-or-nothing: nothing is
  claimed, and the error names the issue and agent holding the path — message them with
  `post_message` if you need it. Nothing is pushed to the holder on a plain rejection —
  its claim didn't change. `force` is different: it posts to both your issue scope (audit)
  and theirs (PROJ-635), since you just took something they thought they still held. Every
  contended path is recorded regardless.

This is the mechanism; the mechanical call sequence for this repo is under "Fleet
coordination protocol" below, and the design rationale (why leases, claims, and the
WIP cap are shaped this way) is the [coordination model](https://tajd.github.io/projektor/philosophy/coordination-model/)
doc. The workflow rules themselves (definition of ready, state machine, human review
gates) live in exactly one place, the [workflow spec](https://tajd.github.io/projektor/agents/workflow-spec/)
— call `get_workflow` before claiming work; they aren't restated here.

## Planning and design docs live in the wiki, not the repo

Design records, implementation plans, and specs belong in the projektor wiki (`create_wiki_page`/`update_wiki_page`), not in a repo `docs/` folder. Keeping them in the wiki makes them discoverable and searchable (`search_wiki`) instead of buried in git history. Root-level user-facing docs (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`) are the only docs that belong in the repo itself.

### Fork divergence record

In `totto2727-org/projektor`, the maintained [`docs/upstream-differences.md`](https://github.com/totto2727-org/projektor/blob/main/docs/upstream-differences.md) is an explicit exception to the wiki-only rule above.
It records this source fork's complete differences from its reviewed upstream revision, including already-merged patches, with their purpose, affected areas and operational impact.
Update it in the same change that adds, alters or removes fork-specific behavior, types, tests, configuration or documentation.
Keep the immutable fork-point commit separate from the reviewed upstream comparison baseline: an upstream sync may advance the latter but must never rewrite the former.
Keep deployment-repository differences in their own repositories and do not turn this record into a plan, progress log or task ledger.
Pull requests for this fork target `totto2727-org/projektor`, never the original upstream repository.

## Human-authored files

Most docs may be generated or written by agents, but these paths are human-authored (Tom's decision, PROJ-915):

- `README.md`
- `apps/docs/src/content/docs/philosophy/**`

Agents must not edit these files, not even to fix a typo or a stale fact. When your work makes one of them inaccurate, add a comment to the current editorial issue (PROJ-914 or its successor) that quotes the affected line and states the fact that changed. Docs checks may still scan these files and report drift, but the fix goes to the editorial issue, never into an agent's diff. `.github/CODEOWNERS` requires @TAJD's review on both paths.

## Architecture: the service-layer contract (most important)

There are **two surfaces** over the same data — a REST API and an MCP (JSON-RPC) server.
They MUST behave identically. The mechanism that guarantees this:

```
routes/<domain>.ts (REST) ─┐
                         ├─► apps/api/src/services/<domain>.ts ─► D1 mutations
mcp/<domain>.ts (MCP) ────┘      │ app validation, authorization, API shaping
                               ▼
                    @projektor/data-services ─► D1 reads
                               ▲
apps/web server loaders ────────┘ app authorization, UI shaping
```

**Rules:**
1. **API business logic, validation, authorization, mutations and response shaping live in `services/<domain>.ts`.** Shared pure DB reads live in `packages/data-services/src/<domain>.ts` and are reused by API services and Web server loaders. Shared queries take explicit DB/scope inputs and app-authored predicates, not HTTP requests, credentials, UI props or authorization decisions. Routes and MCP tools are thin wrappers that resolve context, call the service and adapt the result/error. No SQL in `routes/` or `mcp/`.
2. **REST and MCP must stay at parity.** If you add or change behavior, do it in the service so *both* surfaces get it. Adding a feature to only one surface is a bug.
3. **Validation happens inside the service** via a shared Zod schema in `schemas/<domain>.ts` — so REST and MCP are validated identically. Never trust raw `unknown` input in a wrapper.
4. **Services throw typed errors** from `services/errors.ts` (`ValidationError`, `NotFoundError`, `ForbiddenError`, `ConflictError`). The wrappers translate them:
   - REST: `http/error-adapter.ts` → HTTP status (400/404/403/409)
   - MCP: `mcp/error-adapter.ts` → a tool result with `isError: true` and `{error: {code, message, fields?, hint?, details?}}` (PROJ-893; `code` is the service error kind). JSON-RPC `error` is only for protocol faults and unexpected internal errors. Never return raw `String(err)` to clients.
5. **Context** is a `ServiceCtx` (`services/types.ts`): `{ db, kv, r2, workspaceId, userId, role? }`. Build it with `ctxFromHono(c)` in REST; the MCP dispatch (`routes/mcp.ts`) builds the equivalent and passes `role` through `PluginContext`.

### Deliberate REST↔MCP parity exceptions

These surface-only features are intentional, not drift — don't re-flag them in future
audits:

- **File attachment upload/download (`POST /api/files`, `GET /api/files/:id`)** —
  REST-only. Binary/multipart upload and streamed download can't cross JSON-RPC.
  Metadata operations (list, get metadata, link-create, delete) have full MCP parity
  via `mcp/files.ts`.
- **Auth (`routes/auth.ts`): login redirect, API token minting/revocation** — REST-only.
  CF Access login is a browser redirect flow; token minting/revocation is a sensitive
  credential operation kept off the MCP surface.
- **Workspace-scoped API tokens (`POST/GET/DELETE /api/workspaces/:slug/tokens`)** —
  REST-only, same rationale as auth tokens above.
- **`GET /api/workspaces/:slug/mcp-info`** — REST-only. Bootstraps how to connect an MCP
  client in the first place; inherently can't be an MCP tool.
- **Cross-workspace project list (`GET /api/projects` → `listAllProjects`)** — REST-only.
  MCP connections are bound to a single workspace (`/mcp/<workspaceId>`), so a
  cross-workspace listing doesn't fit the MCP connection model. MCP's `list_projects` is
  the single-workspace equivalent (different, plainer shape — no `open_issue_count` /
  `workspace_name` rollups).
- **Public issue sharing (`POST /api/issues/:id/share`, `GET /api/share/:token`)** —
  REST-only. Share-link creation/redemption is a browser-facing feature (the redemption
  endpoint is intentionally unauthenticated by token).
- **`get_prioritized_issues`** — MCP-only. An agent-productivity tool ("what should I
  work on next") with no natural REST/browser analog.
- **Wiki export (`GET /api/wiki/export`)** — REST-only. Returns a binary zip
  (markdown + attachments) which can't cross JSON-RPC the same way file download
  can't (see the file-attachment exception above); import is explicitly out of
  scope (PROJ-497) so there's no round-trip MCP surface to keep parity with either.
- **Public feedback submission (`POST /api/feedback/submit`)** — REST-only.
  Anonymous end-user feedback from a third-party product, authenticated by a per-source
  bearer token, not a session — there's no ServiceCtx user/role for an MCP tool to act as.
  Feedback *source management* (create/list/update/rotate/revoke) and authenticated
  *read/triage* (`list_feedback`, `update_feedback_status`, `convert_feedback_to_issue`)
  both have full REST+MCP parity, same as every other domain; only the anonymous submit
  endpoint itself is the exception (PROJ-668).
- **OAuth consent (`GET/POST /oauth/authorize`, `services/oauth.ts`)** — REST-only, and
  browser-only. The whole point of the consent screen is that a *human* decides which
  client may act as them; an agent is the subject of a grant, never the party that
  approves one. `middleware/auth.ts` fails the route closed for API tokens and for the
  shared PUBLIC_READ_ONLY viewer for the same reason. `/oauth/token` is not a projektor
  route at all — the OAuth library serves it before Hono sees the request.
- **Connector grants (`GET/DELETE /api/workspaces/:slug/connectors`)** — REST-only, for
  the same reason token minting is: withdrawing a credential is a sensitive operation, and
  a connector should not be able to enumerate or revoke credentials — least of all its
  own siblings. The list is scoped to the requesting user, not the workspace: a grant is a
  personal credential, so unlike `pk_` tokens no admin can see or revoke someone else's.

### The security invariant: always scope by workspace
Every query MUST be scoped by `workspace_id` (directly, or via a parent entity that was itself workspace-checked — e.g. comments verify their issue belongs to the workspace first). A missing scope is a cross-tenant data leak. This is the single most important correctness rule in the codebase.

### The D1 limit: never bind a row-scaled array into one query
Cloudflare **D1 rejects any query with more than 100 bound parameters.** A query whose parameter count grows with an input array — drizzle `inArray`, a raw `IN (...)`, or a batched mutation keyed by ids — will throw at runtime (a 500) once the array is large enough. **This is invisible in tests:** the vitest runner backs D1 with SQLite (cap 32766), so an un-chunked query passes CI and only fails on real D1.

Route every variable-length `IN`/`inArray` load through **`inChunks` (`services/sql.ts`)**, which splits the array so each query stays under the cap:

```ts
const rows = await inChunks(issueIds, (chunk) =>
  orm.select(...).from(...).where(and(inArray(table.id, chunk), eq(table.workspaceId, ctx.workspaceId)))
);
// for a mutation that returns nothing, have the callback return []
```

Bounded arrays (enums like priority) are fine to bind directly. When in doubt, chunk.

## Versioning

`apps/web/package.json` preserves the application version `0.7.6` when the former workspace-internal SSR app replaces the Astro frontend.
It remains the application version source, while internal `apps/api`, `apps/docs` and `packages/*` retain their workspace placeholder versions.
Keep dependency versions pinned as required by the source-owned Alchemy/Effront integration.
Do not infer a static release-artifact/deployment contract from the preserved application version or point version automation at the removed app.

## File layout per domain

When adding/changing a domain (issues, projects, wiki, comments, …):

| File | Role |
|------|------|
| `apps/api/src/services/<domain>.ts` | app business logic, authorization, mutations, validation, API shaping and query adapters |
| `apps/api/src/schemas/<domain>.ts` | Zod schemas (single source of truth; shared primitives in `schemas/common.ts`) |
| `apps/api/src/routes/<domain>.ts` | REST wrapper (mounted in `index.ts`) |
| `apps/api/src/mcp/<domain>.ts` | MCP tool array (composed in `routes/mcp.ts`) |
| `apps/api/src/test/<domain>.test.ts` | **domain tests go here** |
| `packages/data-services/src/<domain>.ts` | shared server-only DB reads, relational projections and typed query errors |
| `packages/data-services/tests/<domain>.test.ts` | shared query regressions, separate from app authorization and response tests |

**Test convention (don't skip this):** put a domain's tests in its own `<domain>.test.ts`. Do **not** pile MCP tests into the shared `test/mcp.test.ts` — parallel work on multiple domains will collide there on merge. (`mcp.test.ts` is for cross-cutting dispatch behavior only.)

## Conventions & gotchas

- **Adding a migration?** After adding a new `.sql` file to `packages/db/migrations/`, you must also add a corresponding `?raw` import to `apps/api/src/test/migrations.ts` and append it to the `MIGRATIONS` array. Without this the test DB won't have the new table and integration tests will silently fail or error. Migrations are **hand-written SQL** — drizzle-kit's generator is deliberately not wired up (PROJ-643): its journal was abandoned after `0001`, so `drizzle-kit generate` diffed against a snapshot ~52 migrations stale and emitted a full `CREATE TABLE` for every table, which would fail against any non-empty database. Don't re-add it without re-baselining the snapshot first. A migration that adds an index ends with `PRAGMA optimize;` so the planner has fresh statistics (PROJ-857).
- **Deletes never rely on FK cascades.** Deleting a row that other tables reference must remove (or null) those rows explicitly in the service, in the same `db.batch()` - `ON DELETE CASCADE/SET NULL` in the schema is not the cleanup (PROJ-407/918), and FTS mirrors, R2 objects and non-FK references have no cascade at all. Adding an FK with `ON DELETE` means adding the cleanup and an entry in `apps/api/src/test/architecture/fk-cleanup-allowlist.ts`; `fk-cleanup.node.test.ts` fails otherwise. (`PRAGMA foreign_keys = OFF` is a no-op on D1/Miniflare, so tests can't switch cascades off to prove cleanup.)
- **camelCase at the boundary, snake_case in the DB.** Input schemas use `assigneeId`, `parentId`, etc.; the service maps to the `assignee_id` column. Keep both surfaces on the same naming.
- **JSON columns** (`labels`, `scopes`) are stored via `JSON.stringify` and returned as raw JSON strings — callers `JSON.parse` on read. There is no automatic (de)serialization.
- **Timestamps** are unix seconds: `Math.floor(Date.now() / 1000)`.
- **IDs** are `crypto.randomUUID()`.
- **Issue numbers** use `COALESCE(MAX(number),0)+1` per project — known race under concurrency (tracked as a follow-up).
- **Auth** (`middleware/auth.ts`): Cloudflare Access JWT (browser) OR `Authorization: Bearer <token>` (agents) OR a dev bypass (`DEV_USER_EMAIL`, non-prod only, and never on `/mcp/` — a remote MCP client learns it must authenticate from the 401 challenge, so answering 200 makes the connector flow unreachable). API tokens are workspace-scoped — don't widen that.
- **Login provisioning** (`services/provisioning.ts`): runs on every CF Access / dev-bypass login (not the token path). Cloudflare Access is the gate; config decides what a user gets inside — `ADMIN_EMAILS` → `owner` (first admin login also creates the `DEFAULT_WORKSPACE_SLUG` workspace), everyone else → `AUTO_JOIN_ROLE` (default `none` = invite-only; set it, e.g. `viewer`, to auto-join). Idempotent; safe to run per request.
- **Roles** (`owner`/`admin`/`member`/`viewer`) are enforced in services via `ctx.role`. Mutations generally block `viewer`; destructive ops may require `owner`.
- **Group-based project access** is the authorization model for project-scoped data. Access is **default-deny**: owner/admin see everything, but everyone else sees a project only if one of their **groups** holds a `(project, role)` grant. The effective in-project role is the strongest grant across the user's groups and *replaces* their workspace role inside that project (so a workspace `viewer` with a `member` grant can write there). Enforce it through `services/access.ts`: `visibleProjectPredicate` (an indexed `EXISTS` subquery — filter every project-scoped **list** query with it), `effectiveProjectRole`/`requireProjectAccess` (resolve a single resource; `null` → 404 to hide existence), and `canWriteProject`. Membership is read per-request, so grant/revoke takes effect on the next request with no session state. The `groups` domain (service/routes/mcp) is owner/admin-only CRUD over groups, members, and grants.
- **The plugin system is not wired at runtime yet** (`pluginRegistry` is empty; `enabled_plugins` is unread). Treat `plugins/*` as not-yet-functional until that lands.

## localStorage policy (frontend)

`localStorage` may only store **cosmetic preferences** (theme, view mode, layout choices).
Never store server-side entity references (workspace slug, project ID, user ID) — a deleted
or renamed entity leaves a stale value that will silently cause API 4xx errors.

**Before adding a new `localStorage.setItem` call, ask:**
1. Does a stale value ever reach an API request? If yes → don't store it; derive it from
   props or request-resolved runtime context instead.
2. Does a missing value crash the UI or produce a non-graceful error? If yes → add a
   safe fallback, not localStorage.

Mark safe usages with a `// safe-ls:` comment explaining why (cosmetic, no API dep,
degrades gracefully). This is the convention established in PR #99.

## Frontend: Effront, request identity and Effect HTTP

`apps/web` is the React/Effront SSR application, not the former Astro/Preact island app.
The API and frontend share the source-owned Alchemy stack but retain their own execution and authorization boundaries.
API business logic and mutations stay in `apps/api/src/services/`, with unchanged REST/MCP parity.
Pure D1 reads are shared through `@projektor/data-services`, with authorization and UI/API shaping retained in each app.

- Resolve the authenticated user, workspace and project in request-local server scope before loading protected page data. Do not guess a tenant from the hostname or `PUBLIC_WORKSPACE_SLUG`, pick the first project, or retain identity in a cross-request module store.
- `apps/web/src/request.ts` owns request-local services and caches; `apps/web/src/server/api-client.ts` builds Effect `HttpClientRequest` values. HTTP operations decode concrete DTOs with `HttpClientResponse.schemaBodyJson` inside `Effect.scoped`. Provide the HTTP layer only at application/Worker execution boundaries, not inside domain loaders.
- `/auth/me` remains the API credential verifier. Web direct-read scope rejects bearer-token requests and the shared public viewer rather than bypassing token restrictions. `server/data-context.ts` enforces authenticated workspace membership and project visibility before shared reads, scopes queries and hides query diagnostics. Do not treat a DB binding or frontend selection as authorization. Privileged metadata stays app-authorized and redacted.
- The HTTP layer uses the Alchemy-provided `API` Worker service binding via `fromCloudflareFetcher` and `toHttpClient`. Forward the actual user credential only to that trusted API, with a configured logical API URL and `X-Workspace-Slug` for scoped requests. Do not replace native service-binding transport with public network fetch or let arbitrary URLs carry credentials. Frontend context selection never replaces backend authorization.
- Protected domain reads use named shared DB queries on the server. Authentication, public-share and other retained HTTP operations stay narrowly scoped. Mutations use native Effront actions/server functions and HTTP through the API service binding; the browser has no direct API fetch path and never receives DB access.
- Server page loaders prepare canonical initial DTOs. Client components receive serializable props, not a `Request`, environment, API client or server scope.
- Use native GET forms and URL tabs for filters and navigation, native `useActionState` for simple actions, and TanStack Form with Effect Standard Schema validation for stateful forms. Literal Effront `ServerFn.make` operations validate and authorize independently.
- Let Effront own routing, Back/Forward and action-driven canonical refresh. Do not add a generic client HTTP dispatcher, custom router, refresh bus or replacement canonical store.
- Authentication changes use native document forms so the old identity's runtime is discarded. File GET/HEAD transport is narrowly scoped, not a generic API proxy. HTML and Flight responses remain private.
- Keep persisted timestamp labels deterministic and explicitly UTC across SSR/hydration. Client width measurement must not cause project tabs to widen the initial mobile document.
- Attachments use native Effront transport. Its 10 MiB total request cap includes multipart overhead, while the backend's existing 50 MiB policy remains unchanged. Do not bypass the framework limit.

React/Effront ports the product surfaces with a similar UI rather than requiring exact legacy DOM/CSS parity.
Use the 22 maintained shadcn `4.21.1` `base-nova` components in `components/generated/`, built on Base UI, for shared controls; keep product-specific adaptation in app components.
Each generated component records its intentional `cn` utility import alias change to `@/lib/utils` in a per-file note. Document any further intentional generated-source change and its purpose; mechanical lint/format changes are not product customization.
Dynamic user-authored Markdown uses runtime Comark `0.6.2` with its Markdown parser defaults and the mdts-style footnotes, math, Mermaid, Shiki and TOC plugins, plus scoped wiki links, not Effront's static Markdown compilation path.
`components/markdown/render.ts` creates a parser per render and sanitizes final authored and plugin-produced HTML/SVG with an explicit tag/attribute/style/URL allowlist. Treat user HTML as untrusted; do not move security handling into navigation or API loading.

`?projectId=` identifies a project, while `?id=` identifies a page entity such as an issue.
Retain workspace/project scope in shareable navigation without assuming browser-global project signals survive.
Named views may use user/workspace/project-scoped per-tab sessionStorage, not entity-bearing cosmetic localStorage.

## Dev workflow and validation

Use the root `justfile` for task entry points and inspect available recipes with `just --list`.

```bash
just dev
just plan
just deploy
```

These wrap the source-owned Alchemy CLI workflow, not a config-only deploy example.
`just deploy` mutates Cloudflare and must remain an explicit operator action.
`just plan` is not a standalone build, and Alchemy `2.0.0-beta.79` has no standalone build CLI.
The CLI requires an authenticated Alchemy profile even for local development or planning, so these commands are not an offline smoke-test guarantee.
Supply the deployment configuration and preserved secrets required by the stack before starting it.
Local non-production API bootstrap and `DEV_USER_EMAIL` remain backend capabilities, not an excuse to weaken production Access enforcement or to bypass MCP authentication.

VitePlus provides the integrated task runner, Oxlint/Oxfmt checks, type checking and test entry points.
Run `just check`, `just test` and `just format` for the maintained local checks, and `pnpm gen:docs` for generated documentation.
`pnpm build` currently builds the retained documentation package, not an Alchemy Worker artifact.
The `just e2e` recipe uses the official local runtime host for the real Worker graph, which is separate from the authenticated Alchemy CLI path.
The only active GitHub workflow is `.github/workflows/ci.yml`, running `pnpm exec vp run ci` after a frozen install. Root `vite.config.ts` limits CI format and typed lint to API/Web, DB/data-services/types, `infra/`, `alchemy.run.ts` and core configuration, and runs API/Web/DB/data-services tests plus `test:infra` configuration regressions. It does not run docs generation/builds, plugin tasks, browser E2E or deployments. `just check` uses the same `ci:check` typed-lint and `ci:format` tasks; `just test` runs `test:packages`, including infra tests. The broader root `type-check` script still exists for optional docs/plugin maintenance, but is not the `just check` or CI contract.
Use repository tasks rather than reinstating Turbo, Biome, Lefthook or direct standalone tool orchestration.
API TypeScript `6.0.3` is retained only as a library for existing AST architecture tests, not as a `tsc` CLI/check script. Workspace overrides pin TypeScript `6.0.3` and Node types `24.13.3` to keep peer type identity consistent across the Vite integration.
The Astro documentation site remains supported through its package tasks.
Generated documentation, including this conventions mirror, must remain fresh even though minimal CI does not enforce generation. Regenerate only this mirror with `corepack pnpm exec tsx scripts/gen-conventions-page.ts` when changing AGENTS.md; `pnpm gen:docs` also regenerates other documentation.
CI is the merge gate, and successful lint/type/test checks do not establish production deployment or all-feature browser acceptance.
Production/preview deployment automation is not implemented in CI. Its separate follow-up is [TOT-252](https://linear.app/totto2727/issue/TOT-252/projektor-alchemy本番プレビューデプロイのgithub-actionsを整備).

Browser verification must use the real Effront RSC/nested SSR Worker and API with a stable artifact.
Check cold identity resolution, workspace/project switches, permission failures, native forms, URL filters/tabs, Back/Forward, action-driven refresh, attachments and authentication transitions.
The removed Astro app's Playwright suite and island checks are historical, not a current `apps/web/e2e` contract.
Do not claim newly completed browser acceptance from tests or measurements on the prior standalone SSR snapshot.

## Fleet coordination protocol

The workflow rules (definition of ready, state machine, human review gates, WIP
limits) have exactly one home: the [workflow spec](https://tajd.github.io/projektor/agents/workflow-spec/),
served live via the `get_workflow` MCP tool / `GET /api/workflow`. Call it before
claiming work — don't rely on a copy of the rules here, they aren't restated in this
file.

What *is* repo-specific and stays here: the mechanical call sequence agents use to
avoid colliding in this particular repo's git worktree/file layout.

### Session identity (PROJ-894)

`register_agent` (and `start_work`) records the credential the call authenticated with on
the session (`agent_sessions.credential_id` + `auth_method`). A lone agent on its own
credential may then omit the agent id on `claim_issue`, `heartbeat_agent` and `end_agent`.
**Fleets that share one credential (one `pk_` token for every worker) should still pass
`agentId` explicitly**: with several live sessions on the credential an omitted id is
ambiguous and is rejected. No per-connection state exists; the session is looked up from the
credential on every call (PROJ-452 statelessness holds).

### The two-call path (PROJ-929)

`start_work` and `finish_work` collapse the sequence below into two calls:

1. `start_work({ issue, paths, name })` at session start — registers the session, claims
   the issue and files (if given), and posts the start message. All-or-nothing with
   compensating cleanup, not a single atomic write (D1 has no cross-call interactive
   transaction): on any conflict (the same `claim_issue`/`claim_files` errors as before)
   the session is ended and nothing is left claimed. If the process crashes mid-call
   (so that cleanup never runs), the claims it made become reclaimable once the
   session's heartbeat goes stale after the 120s TTL, same as any other stale holder.
   Save the returned `sessionId`.
2. `finish_work({ sessionId, issue, completionReport?, status? })` when done — optionally
   transitions the issue via the same path `update_issue` uses (completion-report rules
   apply unchanged), then releases every claim/lease the session holds and ends it.

`claim_issue`/`claim_files`/`update_issue`/`post_message` calls made with a live agent
session id refresh that session's heartbeat as a side effect, and `finish_work` ends the
session outright, so an explicit `heartbeat_agent` is optional on this path — call it
anyway if a lot of work happens between `start_work` and `finish_work` with no other
agent-scoped call in between.

### The five-call path (still supported)

The primitives above compose from these, which remain available for finer-grained
control (e.g. claiming files separately from the issue, or checking `list_file_claims`
before deciding whether to `force`):

1. `register_agent` at session start, linking the issue you're implementing — save the returned `id`.
2. `claim_files` before touching any file (check `list_file_claims` first; back off, don't `force`).
3. `post_message` to `scope: "issue:<uuid>"` when you start/blocker/finish; `scope: "workspace"` for fleet-wide notices.
4. `heartbeat_agent` every ~60 s (sessions time out after 120 s of silence).
5. `release_files` then `end_agent` when done.

See the [MCP tool catalog](https://tajd.github.io/projektor/agents/tool-catalog/) for each tool's exact input schema.

---

## Working in parallel (multi-agent)

This repo is built out via parallel workers in separate git worktrees. To avoid conflicts:
- Give each worker a **disjoint file set** (one domain = its 4-5 files above). Domains don't share files *except* read-only shared scaffolding (`services/types.ts`, `services/errors.ts`, `schemas/common.ts`, the adapters) and `routes/mcp.ts`/`index.ts`.
- **Never let two parallel workers edit `routes/mcp.ts`, `index.ts`, or `test/mcp.test.ts`** — serialize those, or assign to exactly one worker.
- Large refactors that touch shared files go in a **foundation phase first** (behavior-preserving), then fan out per-domain.

### Spawn prompt requirement

Workers will not use the coordination primitives unless explicitly told to. Every spawn prompt for a parallel worker **must** include a `## Coordination (required)` section stating the call sequence (either the two-call `start_work`/`finish_work` path or the five-call path) from "Fleet coordination protocol" above.

A full spawn prompt also needs a **Finish** section (what "done" means for the task,
and what to report back) alongside the Coordination section above.

### Fleet planning rules

These are the constraints the fleet skill reads to plan batches. Keep them current when the codebase changes.

**Serialized files** — only one worker at a time, ever:

| File | Reason |
|------|--------|
| `apps/api/src/routes/mcp.ts` | MCP tool registry — all domains compose here |
| `apps/api/src/index.ts` | Hono app root — route mounting |
| `apps/api/src/test/mcp.test.ts` | Cross-cutting dispatch tests — domain tests go in `test/<domain>.test.ts` |

**Domain → file ownership** — one agent per row, no overlap:

| Domain | Service | Schema | Routes | MCP | Tests |
|--------|---------|--------|--------|-----|-------|
| issues | `services/issues.ts` | `schemas/issues.ts` | `routes/issues.ts` | `mcp/issues.ts` | `test/issues.test.ts` |
| projects | `services/projects.ts` | `schemas/projects.ts` | `routes/projects.ts` | `mcp/projects.ts` | `test/projects.test.ts` |
| wiki | `services/wiki.ts` | `schemas/wiki.ts` | `routes/wiki.ts` | `mcp/wiki.ts` | `test/wiki.test.ts` |
| files | `services/files.ts` | `schemas/files.ts` | `routes/files.ts` | `mcp/files.ts` | `test/files.test.ts` |
| sprints | `services/sprints.ts` | `schemas/sprints.ts` | `routes/sprints.ts` | `mcp/sprints.ts` | `test/sprints.test.ts` |
| comments | `services/comments.ts` | `schemas/comments.ts` | `routes/comments.ts` | `mcp/comments.ts` | `test/comments.test.ts` |
| task-types | `services/task-types.ts` | `schemas/task-types.ts` | `routes/task-types.ts` | `mcp/task-types.ts` | `test/task-types.test.ts` |
| custom-fields | `services/custom-fields.ts` | `schemas/custom-fields.ts` | `routes/custom-fields.ts` | `mcp/custom-fields.ts` | `test/custom-fields.test.ts` |
| workflow | `services/workflow.ts` | — (no input) | `routes/workflow.ts` | `mcp/workflow.ts` | `test/workflow.test.ts` |
| flow-metrics | `services/flow-metrics.ts` | `schemas/flow-metrics.ts` | `routes/flow-metrics.ts` | `mcp/flow-metrics.ts` | `test/flow-metrics.test.ts` |
| groups | `services/groups.ts` | `schemas/groups.ts` | `routes/groups.ts` | `mcp/groups.ts` | `test/groups.test.ts` |

Frontend components are **not** domain-locked in the same way, but two agents must never own the same component file.
Assign each component to exactly one agent per batch.

**Deploy:** use `just plan` to inspect the source-owned Alchemy stack and `just deploy` only for an explicitly authorized deployment. Preserve production names, bindings and existing secrets. See the [deploy guide](https://tajd.github.io/projektor/guides/deploying/).

**CI:** `.github/workflows/ci.yml` runs root `vp run ci` for core/infra format and typed lint, API/Web/DB/data-services tests and native Alchemy configuration regressions only. Generated docs must remain fresh through manual generation, but docs/plugin pipelines, docs builds, E2E and deploy jobs are not CI gates. Do not restore Turbo/Biome/Lefthook, legacy island checks or static-release build commands against the replaced frontend.

**Merge ordering rule:** if two agents both touch the same frontend file (e.g.
`IssueList.tsx`), assign one as "primary" and one as "secondary". Primary merges
first; secondary rebases onto main before merging. Document this in the spawn prompts
and in the fleet manifest.

---

## MCP tool catalog

All tools are available via `POST /mcp/<workspaceId>` (JSON-RPC 2.0). Connect with:

```bash
claude mcp add --transport http --header "Authorization: Bearer <token>" \
  projektor https://<host>/mcp/<workspaceId>
```

**The full tool list is generated from source — do not hand-maintain a copy here.**
See the **[MCP tool catalog](https://tajd.github.io/projektor/agents/tool-catalog/)**
(generated into `apps/docs/src/content/docs/agents/tool-catalog.md` by
`apps/api/scripts/gen-mcp-catalog.ts` from `apps/api/src/mcp/*.ts`; regenerate it when changing tools even though minimal CI does not check freshness). The grouping there separates **Coordination** tools (the agent-native primitives
used by the fleet protocol above) from **Project data** tools.

**Tip:** `get_issue` accepts `ref: "PROJ-42"` (project key + number) — you don't need the UUID when you have the display key.

**`tools/list` caching:** the response carries `ttlMs`/`cacheScope` hints (SEP-2549); `cacheScope` is `"private"` because the list varies per query string (`?domains=`, PROJ-716). These are advisory only — projektor has no server-side cache backing them — so a client that caches `tools/list` must key on the full request URL (path + query), not the path alone, or it will serve one caller's filtered catalog to another.
