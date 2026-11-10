# Planning steering — Slice 1

Phase: planning. Every active rule is mapped to prompt constraints and evidence.

| Rule | Authority | Prompt constraint | Prompts | Owner |
|---|---|---|---|---|
| `architecture-boundaries` | blocking | Template engine pure compile/AST/hash; no AWS/Chromium in the engine or domain; local Chrome stays in the worker rendering adapter | P-101, P-103, P-104 | TECH_LEAD |
| `solid-principles` | advisory | Small engine API; CLI commands are thin; network module has one responsibility | P-101, P-102, P-104 | TECH_LEAD |
| `dependency-inversion-container` | advisory | Preview renderer is injected/selected at the edge; no global browser singleton | P-103 | TECH_LEAD |
| `code-examples` | blocking | Follow shipped TypeScript examples; no project override exists yet | P-101–P-104 | TECH_LEAD |
| `repository-flow` | blocking | Trunk-based `main`; one disposable prompt branch per prompt | All | DEVOPS |
| `saga-pattern` | advisory | Not applicable: template/network work has no distributed transaction | — | TECH_LEAD |
| `architecture-hexagonal` | blocking | Engine and CLI remain outside AWS; Chrome adapter sits at the worker edge | P-101, P-103 | ARCHITECT |
| `repository-trunk-based` | blocking | Small prompt batches; no long-lived branch; merge and delete per prompt | All | DEVOPS |

## Applied examples

- `hexagonal-port.ts`/`domain-service.ts` for the engine/CLI separation.
- `composition-root.ts` for selecting the local Chrome renderer at the edge.
- `style-example.ts` for explicit types and named errors.

## Constraints

- Only P-101 edits the dependency catalog/lockfile: add `handlebars` and `puppeteer-core`.
- P-102 owns `package.json` template scripts; P-103 owns preview and the generic template.
- P-104 owns network/infra files; P-105 owns CI and the root README.
- No feature flags; no AWS apply in Slice 1.
