# Planning steering — final iteration

| Rule | Authority | Prompt constraint | Prompts | Owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Chromium/pdf-lib/channels/roles behind ports; engine/domain framework-free | P-201–P-205, P-207 | TECH_LEAD |
| `solid-principles` | advisory | Small ports; separate caller/worker roles; no shared role | P-203–P-204, P-207 | TECH_LEAD |
| `dependency-inversion-container` | advisory | One composition root; adapters injected | P-201–P-204 | TECH_LEAD |
| `code-examples` | blocking | Follow shipped TypeScript examples; add project examples if needed | P-201–P-206 | TECH_LEAD |
| `repository-flow` | blocking | Trunk-based main; disposable prompt branch per prompt | all | DEVOPS |
| `saga-pattern` | advisory | Not applicable: one local use case | — | TECH_LEAD |
| `architecture-hexagonal` | blocking | Renderer/archiver/channel/role adapters at the edge | P-201–P-204, P-207 | ARCHITECT |
| `repository-trunk-based` | blocking | Small prompt batches; protected main | all | DEVOPS |

## Constraints

- P-201 owns the dependency catalog/lockfile for `@sparticuz/chromium`, `pdf-lib` and the worker package dependencies.
- P-207 owns Bootstrap/network/role infrastructure; P-208 owns alarms/docs; P-209 owns release smoke.
- P-205 owns render fixtures/CI; no other prompt edits CI for render regression.
- No feature branch; `main` is the integration target.
- Cloud apply/verification is operator-run; prompts prepare code/docs and local evidence.
