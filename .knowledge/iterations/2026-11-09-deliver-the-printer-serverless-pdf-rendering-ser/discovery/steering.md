# Discovery steering — applied rules

Phase: discovery. Source: `orchid-sdd steering context --phase discovery`.
Every active rule is either mapped to acceptance evidence or marked not applicable with a
reason. No technical solution is decided here.

| Rule | Authority | Applicability | Constraint carried into requirements | Evidence / owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Applicable | Domain and application code stay free of AWS SDK, Lambda, S3, SQS and Chromium; adapters own I/O; cross-boundary data uses explicit contract types | R-002, R-003, R-011; `impact.md` boundaries; scenarios in `worker-processing.feature`, `delivery-safety.feature`; owner TECH_LEAD |
| `solid-principles` | advisory | Applicable | Ports are consumer-shaped and small (`PdfRenderer`, `PrintRepository`, `ResultDelivery`); no abstraction without a current consumer; implementations honour failure modes | R-003, R-011; `impact.md`; planned unit seams; owner TECH_LEAD |
| `dependency-inversion-container` | advisory | Applicable | One explicit composition root wires the Lambda handler, AWS adapters and placeholder renderer; constructor injection; no service locator | R-003, R-011; `impact.md`; owner TECH_LEAD |
| `code-style` | blocking | Applicable | Declared lint, format and type-check gates; `tsc --noEmit`; why-only comments; anchors/docblocks for significant units; no history in inline comments | R-006, R-010; `ci-quality.feature`; `consistency-report.md`; owner DEV |
| `code-examples` | blocking | Applicable with fallback | The shipped TypeScript `hexagonal-port.ts`, `domain-service.ts`, `domain-service.test.ts`, `composition-root.ts` and `style-example.ts` are the fallback shape; no project override exists yet; planning/build must cite the applied example | R-002, R-003, R-006; `impact.md`; owner TECH_LEAD |
| `repository-flow` | blocking | Applicable | Declared flow is trunk-based on `main`; no long-lived feature branch; one disposable prompt branch per prompt merged to `main` and deleted | R-010, R-012; `impact.md`; `release-pipeline.feature`; owner DEVOPS |
| `saga-pattern` | advisory | **Not applicable** | One job is one local use case with one print; no multi-service business transaction or compensating step exists. Retries and DLQ handle technical failure, not business compensation | R-003, R-008; `impact.md`; owner TECH_LEAD |
| `discovery-steering` | blocking | Applicable | This artifact maps every active rule; deferred operational items are `A-001`–`A-004`; no rule is silently waived | This file; `Q-001`; owner PM |
| `architecture-hexagonal` | blocking | Applicable | Ports and adapters vocabulary; the use case owns input/output contracts; persistence and transport types do not leak into the domain; renderer and delivery adapters are replaceable | R-002, R-003, R-011; `worker-processing.feature`; owner ARCHITECT |
| `repository-trunk-based` | blocking | Applicable | Short-lived branches, small reviewable changes, protected releasable `main`, no long-lived release branches; no feature flags are planned for this increment | R-010, R-012; `ci-quality.feature`, `release-pipeline.feature`; owner DEVOPS |

## Applied example fit

- `architecture-boundaries` / `architecture-hexagonal`: the TypeScript `hexagonal-port.ts` and
  `domain-service.ts` examples show a domain-owned port and an adapter replaceable in tests.
- `dependency-inversion-container`: `composition-root.ts` shows one explicit wiring point without
  a container.
- `solid-principles`: `invoice-service.ts` shows consumer-shaped contracts and one responsibility
  per unit.
- `code-style`: `style-example.ts` shows explicit types, a named error and a why-only comment.
- `code-examples`: these are fallback examples. A project-specific TypeScript example may be
  proposed during planning/build; it becomes binding only after the required approval.

## Non-applicable and deferred items

- `saga-pattern` is not applicable because this increment has no distributed business
  transaction. The SQS retry/DLQ path is technical failure handling.
- `code-style-typescript` is not in the discovery phase set; it becomes active from assessment
  onward and is carried by `code-style` and `code-examples` here.
- Operational prerequisites `A-001`–`A-004` are deferred, with risk and detection recorded in
  `Q-001`.

## Gate evidence

- Every requirement maps to a scenario in `consistency-report.md`.
- The steering constraints above are reflected in the Gherkin outcomes and the requirement map.
- No blocking rule is unresolved or silently waived.
