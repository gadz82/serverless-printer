# Plan matrix — Foundations increment

| Prompt | Wave | Outcome | Depends on | Estimate | Status |
|---|---|---|---|---|---|
| P-001 — workspace and toolchain | 1 | pnpm workspace, catalog, lint/format/typecheck/test, commitlint, husky, README | — | M | pending |
| P-002 — contracts | 2 | JSON Schemas, generated types, Ajv validation, fixtures, contract tests | P-001 | M | pending |
| P-003 — domain | 2 | entities, ports, use case, error taxonomy, fake-port tests | P-001 | M | pending |
| P-004 — `_smoke` template and manifest | 2 | template identity, sample data, content-hashed manifest script | P-001 | S | pending |
| P-007 — Terraform bootstrap | 2 | state/artifacts buckets, OIDC provider, deploy/plan roles | P-001 | M | pending |
| P-005 — worker | 3 | config, manifest catalog, placeholder renderer, S3/SQS adapters, Lambda handler | P-002, P-003, P-004 | L | pending |
| P-008 — printer module and root | 3 | queue/DLQ, prints bucket/KMS, Lambda/alias, IAM, smoke queue, root wiring | P-007 | L | pending |
| P-006 — LocalStack and local sink | 4 | docker-compose, local runner, callback sink, integration tests | P-004, P-005 | M | pending |
| P-010 — release and smoke | 4 | semantic-release, build/upload, OIDC apply, smoke, rollback, manifest asset | P-004, P-005, P-008 | L | pending |
| P-009 — CI | 5 | quality, contract, LocalStack integration, Terraform checks and plan | P-002, P-003, P-005, P-006, P-008 | M | pending |

## Waves

- **Wave 1:** P-001. Everything else depends on the workspace and catalog.
- **Wave 2:** P-002, P-003, P-004, P-007. Disjoint scopes; contracts, domain, template bundle
  and bootstrap can proceed in parallel.
- **Wave 3:** P-005, P-008. Worker consumes contracts/domain/manifest; printer module consumes
  bootstrap outputs.
- **Wave 4:** P-006, P-010. LocalStack integration and the release workflow touch disjoint files.
- **Wave 5:** P-009. CI consumes the final test commands, infra and workflows.

## Critical path

P-001 → P-002 → P-005 → P-006 → P-009, with P-007 → P-008 → P-010 as the infra/release path.

## Notes

- P-001 owns the catalog and the initial lockfile. Prompts declare `catalog:` references and must
  not edit `pnpm-lock.yaml` by hand; the orchestrator regenerates the lockfile on `main` after
  each wave so `pnpm install --frozen-lockfile` stays valid.
- No prompt adds a dependency outside the P-001 catalog.
- No cross-repo dependency rows are required; single repository.
- Acceptance commands are executable in the repository root unless stated otherwise.
- P-009 plans with `-lock=false` because the read-only plan role cannot write the S3 native lock
  file.
- P-008 must tag the KMS key `Project = name_prefix` and follow the queue/bucket/role naming
  contract expected by the bootstrap deploy policy.
