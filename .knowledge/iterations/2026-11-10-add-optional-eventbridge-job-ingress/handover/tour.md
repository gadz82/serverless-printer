# Tour — optional EventBridge job ingress

1. `infra/variables.tf` — `job_rule` root input: nullable object, bus/pattern validation.
   Prove: `terraform -chdir=infra validate`
2. `infra/modules/printer/variables.tf` — module contract and the same validation.
   Prove: `terraform -chdir=infra/modules/printer test`
3. `infra/modules/printer/main.tf` — EventBridge rule/target, `input_path="$.detail"`, queue-policy
   statement. Prove: the configured test run and `terraform -chdir=infra validate`
4. `infra/bootstrap/iam.tf` — scoped deploy-role `events:*` permissions for `<name_prefix>-jobs`.
   Prove: `terraform -chdir=infra/bootstrap validate`
5. `infra/modules/printer/job-rule.tftest.hcl` — six mocked-provider runs.
   Prove: `terraform -chdir=infra/modules/printer test`
6. `docs/cloud-verification.md#eventbridge-ingress-optional` — live rule/target/policy/event check.
   Prove: follow the checklist after deploy.
