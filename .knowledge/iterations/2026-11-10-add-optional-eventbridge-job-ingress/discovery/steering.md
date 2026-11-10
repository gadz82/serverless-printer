# Discovery steering

| Rule | Verdict | Evidence |
| --- | --- | --- |
| `architecture-boundaries` | not applicable | Terraform-only input/resources; no domain/application code. |
| `solid-principles` | satisfied | One optional ingress concern in the printer module; no worker changes. |
| `dependency-inversion-container` | not applicable | No application wiring. |
| `code-style` | satisfied | Terraform fmt/validate/tflint remain the style gate. |
| `code-examples` | satisfied | Follow the existing module resource and queue-policy patterns. |
| `repository-flow` | satisfied | Technical-only iteration on `main`; the iteration prompt still uses its own temporary branch. |
| `saga-pattern` | not applicable | EventBridge only forwards events; the worker's existing job pipeline is unchanged. |
| `discovery-steering` | satisfied | Gherkin uses `@req:R-301`; no product scope changed. |
| `architecture-hexagonal` | not applicable | No application boundary changes. |
| `repository-trunk-based` | satisfied | Small change on `main`, with a short-lived prompt branch and squash merge. |
