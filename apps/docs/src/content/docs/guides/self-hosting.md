---
title: "Self-hosting Projektor"
description: "Operate this source fork's Effront frontend and API through its Alchemy stack on Cloudflare."
sidebar:
  order: 1
---

This fork's source-owned deployment entry point is the root `alchemy.run.ts` stack.
The checked-in production configuration targets the preserved account and resource IDs in `infra/config.ts`, not an arbitrary new account; its account guard fails closed on a mismatch.
The stack contains the Hono API and the React/Effront SSR frontend, sharing the retained external production D1 ID while KV/R2 remain API-only.
Local development shares one native emulated `LocalDatabase` declaration between the Workers.
It does not require an example deployment repository, downloaded static release artifact or standalone Wrangler configuration.
The Astro documentation site remains part of the source workspace.

## Source-owned workflow

From the application repository root:

```bash
just dev
just plan
just deploy
```

Use `just --list` to inspect the current recipes.
Alchemy CLI profile authentication is required even for local development and planning.
`just plan` is not a build command, and Alchemy `2.0.0-beta.79` has no standalone build CLI.
`just deploy` mutates Cloudflare and must be an explicit operator action, not an automatic consequence of documentation edits or local checks.

For an existing instance, preserve Worker names, resource identities, Access settings and the actual existing `JWT_SECRET` supplied through the deployment environment.
Do not create replacement data stores, rotate secrets or assume remote migrations ran as part of a source migration.
The [full deployment guide](/projektor/guides/deploying/) describes configuration, resource preservation, authentication boundaries and honest verification limits.

## Configure access

Cloudflare Access remains the browser identity gate, with the configured API audience and policy preserved.
The API still provisions owner access from `ADMIN_EMAILS` and enforces workspace/project permissions.
The frontend verifies browser identity with API `/auth/me` and forwards the actual user credential for mutations/retained HTTP operations through its native API Worker service binding, not a shared privileged token.
Server loaders and API services reuse pure `@projektor/data-services` D1 reads, with app-owned authorization and UI/API shaping.
Web direct-read scope rejects bearer-token requests and the public viewer rather than bypassing their restrictions; the browser has no direct API fetch or database access.
Keep OAuth machine-to-machine discovery/token carve-outs while protecting human consent at `/oauth/authorize`.

The retired `PUBLIC_WORKSPACE_SLUG` setting does not select a tenant.
Projects and workspace memberships determine context at request time, so one deployment can serve multiple workspaces.

## Verification boundaries

Only `.github/workflows/ci.yml` runs VitePlus core/infra checks, API/Web/DB/data-services tests and native Alchemy configuration regressions.
`just check` shares the CI typed-lint/format tasks, and `just test` includes infra tests.
Docs/plugin pipelines, browser E2E and deployment jobs are not part of minimal CI; production/preview GitHub Actions remain separate [TOT-252](https://linear.app/totto2727/issue/TOT-252/projektor-alchemy本番プレビューデプロイのgithub-actionsを整備) work.
The `feat/alchemy-deployment` source integration is not evidence of a production deploy or passing browser E2E.
See the deployment guide for preflight account/Access/secret guards and the public runtime/deployment phase split.

## Next: connect an agent

Once your instance is up, [connect an AI agent](/projektor/agents/mcp-connection/) over MCP.
The backend retains its REST/MCP service-layer parity, including the documented browser-only credential and binary transport exceptions.
