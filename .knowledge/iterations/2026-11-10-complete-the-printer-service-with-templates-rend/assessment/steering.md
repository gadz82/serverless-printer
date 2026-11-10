# Assessment steering

Phase: assessment. Every active rule is mapped to a decision and evidence.

| Rule | Authority | Decision / constraint | Evidence | Owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Template engine/domain stay free of AWS/Chromium/pdf-lib; Chromium, PDF/A and channels are adapters | `impact-map.md`; ADR-101/102/103/104 | TECH_LEAD |
| `solid-principles` | advisory | Small ports: `PdfArchiver`, channel delivery, callback policy; no speculative abstraction | `impact-map.md`; ADR-103/104 | TECH_LEAD |
| `dependency-inversion-container` | advisory | One composition root wires Chromium, pdf-lib, channels and allowlist; no service locator | ADR-102/104 | TECH_LEAD |
| `code-style` | blocking | Lint/Prettier/tsc; anchors/docblocks for new significant units | `regression-plan.md`; CI | DEV |
| `code-examples` | blocking | Use shipped TS examples; add project examples if a new pattern appears | `regression-plan.md`; planning | TECH_LEAD |
| `repository-flow` | blocking | Trunk-based `main`; no feature branch; disposable prompt branches | ADR-107; `impact-map.md` | DEVOPS |
| `saga-pattern` | advisory | Not applicable: one job, local use case; channel/PDF-A steps are not a distributed transaction | `impact-map.md`; `regression-plan.md` | TECH_LEAD |
| `architecture-hexagonal` | blocking | Ports for archiver/channels/allowlist; adapters replaceable in tests | ADR-103/104; `impact-map.md` | ARCHITECT |
| `code-style-typescript` | blocking | Strict TS, no implicit any, runtime validation at SQS/HTTP boundaries | `regression-plan.md`; CI | DEV |
| `repository-trunk-based` | blocking | Short-lived prompts, protected releasable `main`; split slices keep batches small | ADR-107; `estimate.md` | DEVOPS |

## Applied example fit

The shipped TypeScript examples remain the fallback for ports, use cases, composition and tests.
The new template engine and adapters must follow the same explicit-type, named-error, why-only
comment shape.

## Not applicable

`saga-pattern`: no distributed business transaction or compensation path.

## Blocking status

No blocking rule is waived. The only open decision is Slice 1 vs single-iteration delivery
(ADR-107), which the human resolves at G3.
