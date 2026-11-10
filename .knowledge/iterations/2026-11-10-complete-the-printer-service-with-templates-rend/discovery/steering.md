# Discovery steering — applied rules

Phase: discovery. Every active rule is mapped to acceptance evidence or marked not applicable.

| Rule | Authority | Applicability | Constraint | Evidence / owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Applicable | Template engine and domain stay free of AWS/Chromium/pdf-lib; adapters own binaries and I/O | R-101, R-107, R-108, R-109; `impact.md`; TECH_LEAD |
| `solid-principles` | advisory | Applicable | Small consumer-owned ports for archiver, channels and allowlist; no speculative abstraction | R-108, R-109, R-110; `impact.md`; TECH_LEAD |
| `dependency-inversion-container` | advisory | Applicable | One composition root wires Chromium, pdf-lib, channels and network-independent clients | R-107–R-110; `impact.md`; TECH_LEAD |
| `code-style` | blocking | Applicable | ESLint/Prettier/tsc; why-only comments; anchors/docblocks for significant units | All slices; `consistency-report.md`; DEV |
| `code-examples` | blocking | Applicable | Use shipped TypeScript examples; add project examples if the plan introduces new patterns | R-101, R-107; planning; TECH_LEAD |
| `repository-flow` | blocking | Applicable | Trunk-based `main`; no feature branch; one disposable prompt branch per prompt | All slices; `impact.md`; DEVOPS |
| `saga-pattern` | advisory | **Not applicable** | One job is one local use case; channel delivery and PDF/A are steps, not a distributed business transaction with compensation | R-108, R-109; TECH_LEAD |
| `discovery-steering` | blocking | Applicable | This artifact maps every active rule; deferred inputs are `A-101`–`A-105` | This file; PM |
| `architecture-hexagonal` | blocking | Applicable | Ports for `PdfArchiver`, channel delivery, allowlist resolver; adapters replaceable in tests | R-107–R-110; `impact.md`; ARCHITECT |
| `repository-trunk-based` | blocking | Applicable | Short-lived branches, small reviewable prompts, protected releasable `main` | All slices; `impact.md`; DEVOPS |

## Applied examples

- `architecture-boundaries` / `architecture-hexagonal`: `hexagonal-port.ts` and
  `domain-service.ts` guide the new archiver and channel ports.
- `dependency-inversion-container`: `composition-root.ts` remains the only wiring point.
- `solid-principles`: `invoice-service.ts` shape for consumer-owned contracts.
- `code-style` / `code-style-typescript`: `style-example.ts` for explicit types and why-only
  comments.

## Not applicable

`saga-pattern`: no distributed business transaction or compensation path. Channel retries and
DLQ handling are technical failure handling.

## Open inputs

`Q-101` / `A-101`–`A-105`: throughput, AWS/VPC, first template, alarm/allowlist and staged split.
These are assessment/operator inputs, not discovery blockers.
