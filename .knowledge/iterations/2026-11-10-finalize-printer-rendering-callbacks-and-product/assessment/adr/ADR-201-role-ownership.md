# ADR-201 — Separate caller and worker roles with generated/provided modes

- Status: proposed
- Date: 2026-11-10
- Deciders: ARCHITECT, SECURITY, DEVOPS, human release owner
- Related: R-212–R-218, S-211–S-214

## Context

Integrators need a role to publish new prints to the jobs queue. The Lambda needs a different role
to consume jobs and publish results to the delivery channels the integrator provides. The deployer
wants to choose, at Terraform level, whether each role is generated or supplied. The default is
generation. A single shared role would let callers publish results and the worker enqueue jobs.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Separate caller/worker roles, each create/existing (chosen) | Low | Low | High | Least privilege, reuse without coupling |
| Single shared role | Low | High | Medium | Simple but violates separation |
| Generated only | Low | Low | High | Least flexible for central IAM |
| Provided only | Low | Medium | High | No self-contained default |

## Decision

- **Caller/integrator role:** `caller_role_mode = "create"` (default) or `"existing"`.
  - Generate: trust `caller_trusted_principal_arns` (default deployer account root), policy
    `sqs:SendMessage` only on the jobs queue, output ARN.
  - Existing: require `caller_role_arn`; add it to the queue's allowed senders; do not create or
    modify IAM. Cross-account callers are possible via their trust policy.
- **Worker execution role:** `worker_role_mode = "create"` (default) or `"existing"`.
  - Generate: least-privilege consume/S3/KMS/logs/channel policy and Lambda trust.
  - Existing: require a same-account `worker_role_arn` trusting `lambda.amazonaws.com`; use it for
    Lambda, KMS and the smoke queue; do not create or modify IAM.
- Bootstrap gains `additional_worker_role_arns` for `iam:PassRole`.
- Outputs: `caller_role_arn`, `worker_role_arn`, `caller_role_created`, `worker_role_created`.

## Consequences

- Callers can only enqueue jobs; the worker can only consume and publish results.
- Generated roles are reproducible and least-privilege; provided roles fit central IAM governance.
- Provided roles are owner-managed; the stack cannot guarantee trust, permissions or drift.
- Existing worker roles need a bootstrap re-apply to add PassRole.
- Cross-account caller roles are allowed; worker roles must be same-account.

## Rejected options

- Shared role: violates least privilege and the caller/worker boundary.
- Generated-only/provided-only: removes the operator's explicit choice.

## Risk acceptance

Provided-role risk is accepted by the deployer; the generated default remains the recommended
least-privilege path.
