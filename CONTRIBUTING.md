# Contributing

projektor is a personal project, built and maintained by one person (with AI
agents). It's open source under the [MIT licence](./LICENSE) - fork it, deploy
it, modify it, learn from it.

## Issues and pull requests

**Pull requests, issues, and feature requests are all welcome.** projektor is
maintained by one person (with AI agents), so review happens on their own
schedule rather than a fixed SLA - but everything is read and considered.

For security issues, follow [SECURITY.md](./SECURITY.md) (report privately, not
via a public issue).

## Working in the code

If you're modifying a fork, [AGENTS.md](./AGENTS.md) is the source of truth for
conventions: file layout, the service-layer contract (REST and MCP must stay at
parity), and how to work in parallel without conflicts. Read it before changing
anything.

Run the checks through the Nix shell and Vite+ (see [AGENTS.md](./AGENTS.md) for the maintained task and deployment conventions):

```bash
nix develop
vp install --frozen-lockfile
vp run ci
```

`vp run ci` checks formatting and types, then runs every configured test project, including the native Workers API regressions.
Use `vp run test:workers` for the Workers project alone and `vp run e2e` for the real local API/Web Worker browser workflow.
Use `vp run dev` for local development.
CI checks pull requests and main, then deploys production only after successful checks on a main push.
The application is one root package, without Turbo or a docs workspace.
