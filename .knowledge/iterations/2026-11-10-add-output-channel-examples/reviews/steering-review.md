# Steering review — output channel examples

| Rule | Authority | Verdict | Evidence |
| --- | --- | --- | --- |
| `architecture-boundaries` | blocking | not applicable | Docs/examples only. |
| `solid-principles` | advisory | not applicable | No code design change. |
| `dependency-inversion-container` | advisory | not applicable | No wiring. |
| `code-style` | blocking | satisfied | Prettier/lint/typecheck pass. |
| `code-examples` | blocking | satisfied | Examples mirror the current job/result contract and channel behavior. |
| `repository-flow` | blocking | satisfied | Prompt branch, independent review, squash merge, branch removed. |
| `saga-pattern` | advisory | not applicable | No transaction change. |
| `logic-review-steering` | blocking | satisfied | This review and the logic review cite current evidence. |
| `architecture-hexagonal` | blocking | not applicable | No application change. |
| `code-style-typescript` | blocking | satisfied | The validation test follows the existing Vitest/TypeScript conventions and passes typecheck/lint. |
| `repository-trunk-based` | blocking | satisfied | Short-lived prompt branch; squash merge to main. |
