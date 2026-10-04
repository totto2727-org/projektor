# Fork differences from upstream

This is the maintained record for [`totto2727-org/projektor`](https://github.com/totto2727-org/projektor), compared with [`TAJD/projektor`](https://github.com/TAJD/projektor).
It covers this source repository only, including the project-creation fix merged in [fork PR #1](https://github.com/totto2727-org/projektor/pull/1) and the subsequent client workspace changes in [fork PR #2](https://github.com/totto2727-org/projektor/pull/2).
Deployment repositories maintain their own differences separately.

## Comparison revisions

| Revision | Meaning |
| --- | --- |
| [`ab122cbea1bae7efce8abe2345ce07375b9dcd13`](https://github.com/TAJD/projektor/commit/ab122cbea1bae7efce8abe2345ce07375b9dcd13) | Reviewed upstream source baseline. |
| [`290f6644d8ced6d70fe1434437624d59015ff22d`](https://github.com/totto2727-org/projektor/commit/290f6644d8ced6d70fe1434437624d59015ff22d) | Project-creation patch in fork PR #1. |
| [`590ee98ec00b18b34e39d009473d3030bfc39b43`](https://github.com/totto2727-org/projektor/commit/590ee98ec00b18b34e39d009473d3030bfc39b43) | Fork `main` merge of PR #1. |
| [`55d10389929bb8bbccbd70280ce6955a113df4ab`](https://github.com/totto2727-org/projektor/commit/55d10389929bb8bbccbd70280ce6955a113df4ab) | Reviewed frontend snapshot after the full-client scope fix, required project workspace types and static environment retirement. |

These are immutable reference points, not a claim that upstream `main` remains at the baseline.
The summaries and inventory below cover this checkout, including this record and its maintenance instructions, rather than stopping at the pre-documentation snapshot.
Reproduce the complete current comparison with:

```sh
git diff --name-status ab122cbea1bae7efce8abe2345ce07375b9dcd13 HEAD
git diff ab122cbea1bae7efce8abe2345ce07375b9dcd13 HEAD -- apps/web AGENTS.md apps/docs/src/content/docs/contributing/conventions.md docs
```

Before committing, omit `HEAD` to include tracked working-tree changes and inspect `git status --short` for newly added files.

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

The frontend continues to call the existing `apiFetch` header boundary.
Global project/workspace discovery, auth, public sharing, global workflow and read-only playbooks retain their existing backend exemptions from workspace context.
Native file GET subresources keep the backend-supported workspace query fallback where a request header cannot be attached.
No change here creates resources, deploys a Worker, applies remote migrations or rotates secrets.

## Workspace-neutral page delivery

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

## Maintenance rule

Update this record in the same change whenever fork-specific behavior, types, tests, configuration or documentation is added, changed, removed or absorbed upstream.
Record the purpose, affected areas, operational impact and reviewed upstream revision, including changes already merged into fork `main`.
When incorporating upstream, update the baseline deliberately and compare complete trees, not only the current pull request or a merge-base diff.
Keep this source record in this repository and linked from `AGENTS.md`; generated conventions mirror that entry point.
Do not place source-change summaries in a deployment example or use this record for progress logs, temporary artifacts, credentials or task tracking.
Pull requests for fork work target `totto2727-org/projektor`, never `TAJD/projektor`.
