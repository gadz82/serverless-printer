# Assessment steering

Phase: assessment. Source: `orchid-sdd steering context --phase assessment`.
Every active rule is mapped to a decision and the evidence that will prove it.

| Rule | Authority | Decision / constraint | Evidence | Owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Domain/application stay free of AWS SDK, Lambda, S3, SQS and Chromium; adapters own I/O; contracts are explicit types | `impact-map.md` port table; dependency-direction check; future import lint/test | TECH_LEAD |
| `solid-principles` | advisory | Small consumer-owned ports (`TemplateCatalog`, `PdfRenderer`, `PrintRepository`, `ResultDelivery`); one responsibility per unit; no speculative abstraction | `impact-map.md`; unit tests with fakes | TECH_LEAD |
| `dependency-inversion-container` | advisory | One composition root in the Lambda handler wires config, AWS adapters, placeholder renderer and use case; constructor injection; no container | `impact-map.md`; composition-root test | TECH_LEAD |
| `code-style` | blocking | ESLint + Prettier + `tsc --noEmit`; why-only comments; anchors/docblocks for significant units; no history in inline comments | CI commands; `regression-plan.md`; lint/docblock check | DEV |
| `code-examples` | blocking | Shipped TypeScript `hexagonal-port.ts`, `domain-service.ts`, `domain-service.test.ts`, `composition-root.ts`, `style-example.ts` are the fallback; no project override exists yet; prompts must cite the applied example | This file; future prompt constraints | TECH_LEAD |
| `repository-flow` | blocking | Trunk-based `main`; no long-lived feature branch; one disposable prompt worktree/branch per prompt merged to `main` and deleted | `infrastructure-impact.md`; release workflow; prompt reports | DEVOPS |
| `saga-pattern` | advisory | **Not applicable**: one job is one local use case with no compensating business step; retries/DLQ are technical failure handling | `impact-map.md`; `regression-plan.md` failure paths | TECH_LEAD |
| `architecture-hexagonal` | blocking | Ports and adapters vocabulary; use case owns input/output contracts; persistence/transport types do not leak; renderer/delivery replaceable | `impact-map.md`; ADR-003; tests with in-memory adapters | ARCHITECT |
| `code-style-typescript` | blocking | Strict TypeScript, no implicit `any`, runtime validation at the SQS boundary, explicit public types, formatter/linter/type-checker evidence | `contracts.md`; `regression-plan.md`; CI commands | DEV |
| `repository-trunk-based` | blocking | Short-lived branches, small reviewable prompts, protected releasable `main`, no long-lived release branches; no feature flags planned | `infrastructure-impact.md`; release workflow; branch cleanup at G5 | DEVOPS |

## Applied example fit

- `architecture-boundaries` / `architecture-hexagonal`: `hexagonal-port.ts` and
  `domain-service.ts` define the port/adapter and use-case shape.
- `dependency-inversion-container`: `composition-root.ts` defines the single wiring point.
- `solid-principles`: `invoice-service.ts` shows consumer-shaped contracts and single
  responsibility.
- `code-style` / `code-style-typescript`: `style-example.ts` shows explicit types, a named error,
  runtime guards and a why-only comment.
- `code-examples`: these remain fallback examples. Planning may propose a project-specific
  TypeScript example; it becomes binding only after the required approval.

## Not applicable

- `saga-pattern`: no distributed business transaction, no compensation path. The job is one local
  use case; SQS retry/DLQ handles technical failure.

## Blocking-rule status

No blocking rule is waived. All are mapped to an assessment decision and a future evidence point.
The G3 human gate can approve the scope and ADRs with this mapping in place.
