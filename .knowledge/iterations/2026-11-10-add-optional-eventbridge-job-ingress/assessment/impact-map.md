# Impact map

| Area | Change | Risk |
| --- | --- | --- |
| `infra/variables.tf` | Add nullable `job_rule` object + validation | Low |
| `infra/main.tf` | Pass `job_rule` to the printer module | Low |
| `infra/modules/printer/variables.tf` | Add the module input + validation | Low |
| `infra/modules/printer/main.tf` | Rule/target resources and queue-policy statement | Low |
| `infra/terraform.tfvars.example` | Commented example | None |
| `infra/README.md` | Input/resource docs | None |

No application code, contracts, templates, CI, bootstrap, alarms or runbook changes.
