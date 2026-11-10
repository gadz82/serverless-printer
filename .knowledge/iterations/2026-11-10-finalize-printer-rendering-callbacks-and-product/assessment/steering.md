# Assessment steering

| Rule | Authority | Decision / constraint | Evidence | Owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Chromium/pdf-lib/channels/roles behind ports; engine/domain framework-free | `impact-map.md`; ADR-201; prior ADR-102–104 | TECH_LEAD |
| `solid-principles` | advisory | Small port per concern; separate caller/worker roles; no shared role | ADR-201; `contracts.md` | TECH_LEAD |
| `dependency-inversion-container` | advisory | One composition root; browser/archiver/channel adapters injected | `infrastructure-impact.md` | TECH_LEAD |
| `code-style` | blocking | Lint/Prettier/tsc; anchors/docblocks for new units | `regression-plan.md`; CI | DEV |
| `code-examples` | blocking | Follow shipped TypeScript examples; add project examples if needed | planning | TECH_LEAD |
| `repository-flow` | blocking | Trunk-based main; disposable prompt branches | ADR-202; plan | DEVOPS |
| `saga-pattern` | advisory | Not applicable: one local use case, no distributed transaction | `impact-map.md` | TECH_LEAD |
| `architecture-hexagonal` | blocking | Renderer/archiver/channel adapters; use case unchanged | ADR-201; prior ADR-102–104 | ARCHITECT |
| `code-style-typescript` | blocking | Strict TS, runtime validation at SQS/HTTP boundaries | `regression-plan.md` | DEV |
| `repository-trunk-based` | blocking | Short-lived prompts; protected main | ADR-202 | DEVOPS |

## Applied examples

Shipped TypeScript examples remain the fallback; Slice 2 should add project examples if the
renderer/channel patterns become project-specific.

## Blocking status

No blocking rule waived. The only open decision is one final iteration vs a Slice 2/3 split
(ADR-202), resolved at G3.
