# Impact

- Add a nullable `job_rule` object input at the root and printer-module level.
- Add an EventBridge rule and target to the existing jobs queue when configured.
- Extend the jobs queue policy with a service-principal statement scoped to the rule ARN.
- Update the tfvars example and infra README.
- No application, contract, worker, callback, template, CI or bootstrap changes.
- Default `job_rule = null` leaves the deployed resource set unchanged.

Affected paths: `infra/variables.tf`, `infra/main.tf`,
`infra/modules/printer/variables.tf`, `infra/modules/printer/main.tf`,
`infra/terraform.tfvars.example`, `infra/README.md`.

Risk: low; the change is opt-in and isolated to Terraform. The main uncertainty is the queue
policy principal/condition and the first live apply, which remains operator evidence.
