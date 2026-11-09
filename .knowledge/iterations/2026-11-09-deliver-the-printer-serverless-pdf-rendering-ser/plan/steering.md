# Planning steering

Phase: planning. Source: `orchid-sdd steering context --phase planning`.
Every active rule is mapped to prompt constraints and the evidence the prompt must produce.

| Rule | Authority | Prompt constraint | Prompts | Owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Domain/application imports stay free of AWS SDK, Lambda, S3, SQS and Chromium; adapters own I/O; contract types do not leak into the domain | P-003, P-005 | TECH_LEAD |
| `solid-principles` | advisory | Ports are consumer-shaped and small; one responsibility per unit; no abstraction without a current consumer | P-003, P-005 | TECH_LEAD |
| `dependency-inversion-container` | advisory | One composition root wires config, adapters, renderer and use case; constructor injection; no container | P-005 | TECH_LEAD |
| `code-examples` | blocking | Prompts cite the shipped TypeScript examples (`hexagonal-port.ts`, `domain-service.ts`, `domain-service.test.ts`, `composition-root.ts`, `style-example.ts`) as the fallback shape; no project override exists | P-002, P-003, P-005, P-006 | TECH_LEAD |
| `repository-flow` | blocking | Trunk-based `main`; one disposable worktree/branch per prompt; merge to `main`; delete the branch after CR | All | DEVOPS |
| `saga-pattern` | advisory | Not applicable: one job is one local use case; retries/DLQ are technical failure handling, not compensation | P-003, P-005 | TECH_LEAD |
| `architecture-hexagonal` | blocking | Use-case input/output contracts; persistence/transport types stay out of the domain; renderer and delivery adapters are replaceable | P-003, P-005 | ARCHITECT |
| `repository-trunk-based` | blocking | Short-lived prompt branches, small reviewable changes, protected releasable `main`; no long-lived release branches or feature flags | All | DEVOPS |

## Applied examples

- `hexagonal-port.ts` and `domain-service.ts`: P-003 port/use-case shape and P-005 adapter boundary.
- `domain-service.test.ts`: P-003 test seam with an in-memory adapter.
- `composition-root.ts`: P-005 single wiring point.
- `style-example.ts`: explicit types, named errors, runtime guards and why-only comments in P-002,
  P-003 and P-005.

## Planning constraints

- No prompt adds a dependency outside the P-001 catalog; the lockfile is generated once.
- Write scopes are disjoint within each wave; shared files (`package.json`, lockfile) belong to
  P-001 only.
- Every prompt cites requirements, scenarios, decisions and acceptance commands.
- The placeholder renderer and SQS-only delivery are explicit constraints, not implementation
  details to improvise.
- `_smoke` is the only reserved slug (ADR-006); PDF/A is rejected in Phase 1 (ADR-003).
- No cross-repo dependency ledger rows are needed; this is a single repository.
