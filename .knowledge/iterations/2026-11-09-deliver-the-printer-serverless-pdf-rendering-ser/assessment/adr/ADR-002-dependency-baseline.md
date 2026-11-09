# ADR-002 — Foundation dependency and build-tooling baseline

- Status: proposed
- Date: 2026-11-09
- Deciders: TECH_LEAD, DEV, DEVOPS, human release owner
- Related: R-002, R-003, R-004, R-006

## Context

This increment introduces the project's first runtime and development dependencies. The
constitution requires an ADR and an owner for a new dependency. The set should be the smallest
one that proves the queue → worker → storage → callback path, keeps the domain framework-free,
and supports a reproducible release.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Minimal AWS SDK + validation + build/test toolchain (chosen) | Low | Low | High | Fast foundation, small surface |
| Framework (NestJS, Serverless Framework, SST) | Medium | Medium | Medium | More conventions than this scope needs |
| No dependencies beyond Node | Low | High | High | Re-implements UUIDv5, SQS/S3 clients, bundling |

## Decision

**Runtime:** `@aws-sdk/client-sqs`, `@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner`, `ajv` (2020), `uuid` (v5). Logging is a small structured
JSON logger over `console`; no logging framework yet.

**Development:** `typescript`, `tsx` for the local runner, `vitest`, `eslint`, `prettier`,
`esbuild`, `json-schema-to-typescript`, `@commitlint/cli` +
`@commitlint/config-conventional`, `husky`, `semantic-release` with the changelog/git/github/
release-notes plugins, and LocalStack via docker-compose. pnpm is the package manager; Node 24.

Each dependency has an owner (`TECH_LEAD` for runtime, `DEV` for tooling) and is pinned through
the lockfile. Renovation automation is a Phase 3 maintenance item.

## Consequences

- The domain remains free of SDK imports; only adapters use AWS clients.
- The worker bundle stays small in Phase 1 because Chromium and PDF libraries are absent.
- `uuid` supplies a well-tested UUIDv5; the namespace constant is committed.
- The toolchain is conventional and replaceable; no framework lifecycle leaks into the domain.

## Rejected options

- NestJS: adds DI and HTTP conventions the service does not need.
- Serverless Framework/SST: conflicts with the Terraform-only provisioning decision.
- Hand-rolled AWS signing and UUIDv5: unnecessary risk.
- `pdf-lib` now: deferred with the renderer decision (ADR-003).

## Risk acceptance

Dependency maintenance risk is accepted for this increment and revisited when Chromium and
PDF/A arrive.
