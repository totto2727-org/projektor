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

For this source transition, [AGENTS.md](./AGENTS.md) describes the retained files, validation, and production safety constraints.
Read it before changing the removal scope.

This intermediate branch removes the original application before the replacement in [PR #4](https://github.com/totto2727-org/projektor/pull/4).
It has no runnable API or Web application and no dependency installation, build, or deployment command.
The `CI` workflow validates source removal, unchanged historical SQL, and unchanged documentation only.
It does not run application tests.

Review the source-removal PR first, then review PR #4 against that branch.
After the removal PR reaches `main`, retarget PR #4 to `main` and verify its application CI and Worker acceptance again.
Keep production unchanged until the replacement and its migration prerequisites have operator approval.
