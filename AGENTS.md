# Projektor source transition

## Current state

This branch removes the original API, Astro and Preact Web application, workspace libraries, and their build and release tooling.
It is the source-removal prerequisite for [PR #4](https://github.com/totto2727-org/projektor/pull/4), which adds the Effront application and private Core Worker.
This intermediate checkout has no runnable application, package installation, build, test suite, or deployment command.
Do not treat a successful retirement check as application acceptance.

The original README, documentation site, and repository documentation remain unchanged in this prerequisite.
Their old installation and deployment instructions do not apply to this intermediate checkout.
[CONTRIBUTING.md](./CONTRIBUTING.md) describes the review order.

## Preserved migration history

`migrations/` contains the 68 historical SQL files from `packages/db/migrations/` at `841fd00c97eab7fb67c62b6a645b514e6c6989c9`.
File names, contents, and executable modes remain unchanged.
Do not edit applied SQL, fabricate migration ledger entries, replay migrations, or change production data.
The following Effront PR owns any new migration and its rollout prerequisites.

## Validation

The `CI` workflow checks that retired runtime and tooling paths are absent.
It compares the complete historical migration tree with the pinned pre-removal revision.
It also checks that the README and documentation trees are unchanged and that the diff has no whitespace errors.
No dependency installation, runtime test, application build, release, or deployment runs in this intermediate state.
The following PR must restore and pass application CI and real Worker acceptance before deployment.

## Production safety

Removing source files does not delete deployed Workers, D1, KV, R2, secrets, or Access policies.
Do not merge either PR, deploy, rotate secrets, destroy resources, or apply migrations as part of this source split.
Keep existing deployments unchanged until an operator approves the completed replacement and its rollout prerequisites.

## Fork record

Upstream: https://github.com/TAJD/projektor
Fork: https://github.com/totto2727-org/projektor
Upstream comparison revision: `ab122cbea1bae7efce8abe2345ce07375b9dcd13`.
Pre-removal fork revision: `841fd00c97eab7fb67c62b6a645b514e6c6989c9`.

The retained difference in this intermediate revision is removal of the upstream runtime and its workspace, build, and publishing entrypoints.
Historical SQL moves to the root without content changes, while the README and documentation remain unchanged.
CI validates source retirement instead of claiming to test a missing application.
This revision cannot build a new deployment and does not change an existing production deployment.
