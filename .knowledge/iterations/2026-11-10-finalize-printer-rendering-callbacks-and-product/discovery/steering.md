# Discovery steering — applied rules

| Rule | Authority | Applicability | Constraint | Evidence / owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Applicable | Chromium/pdf-lib/channels/roles stay behind ports; engine/domain remain framework-free | R-201–R-204, R-212–R-218; impact; TECH_LEAD |
| `solid-principles` | advisory | Applicable | Small ports for archiver/channels/callback policy; separate caller/worker roles | R-202–R-204, R-216; impact; TECH_LEAD |
| `dependency-inversion-container` | advisory | Applicable | One composition root wires renderer/archiver/channels; role ARNs resolved and injected | R-201–R-204, R-212; TECH_LEAD |
| `code-style` | blocking | Applicable | Lint/tsc/anchors/docblocks for new significant units | all; DEV |
| `code-examples` | blocking | Applicable | Follow shipped TypeScript examples; add project examples if needed | all; TECH_LEAD |
| `repository-flow` | blocking | Applicable | Trunk-based main; disposable prompt branches | all; DEVOPS |
| `saga-pattern` | advisory | **Not applicable** | One job is one local use case; channel/PDF-A steps are not a distributed transaction | R-201–R-204; TECH_LEAD |
| `discovery-steering` | blocking | Applicable | This artifact; deferred A-201–A-206 | PM |
| `architecture-hexagonal` | blocking | Applicable | Renderer/archiver/channel adapters; use case unchanged | R-201–R-204; ARCHITECT |
| `repository-trunk-based` | blocking | Applicable | Short-lived prompts, protected main; role modes keep batches reviewable | all; DEVOPS |

## Not applicable

`saga-pattern`: no distributed business transaction or compensation path.

## Open inputs

Throughput, AWS/VPC, alarms/callbacks, role trust/provided ARNs, branch protection (A-201–A-206).
