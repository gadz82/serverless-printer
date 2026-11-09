# ADR-004 — Bootstrap uses local state; the main deployment uses S3 native locking

- Status: proposed
- Date: 2026-11-09
- Deciders: DEVOPS, TECH_LEAD, human release owner
- Related: R-005, S-016

## Context

`bootstrap/` creates the Terraform state bucket that the main deployment needs. It cannot use a
backend that does not exist yet. The spec requires the main deployment to use an S3 backend with
native locking (`use_lockfile = true`). Something must hold bootstrap's own state.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Local state for bootstrap, applied once by an admin (chosen) | Low | Medium — state loss | High | Simple, no chicken-and-egg |
| Pre-create a separate state bucket manually | Low | Medium — manual drift | High | Extra manual prerequisite |
| Terraform Cloud or another remote backend | Medium | Low | Medium | Extra vendor and credentials |

## Decision

Run `bootstrap/` with local state, never commit `terraform.tfstate`, and have the operator store
it in the team's secure secret store. Document the exact command and outputs. The main
deployment uses the created S3 bucket as its backend with `use_lockfile = true`, key
`printer/terraform.tfstate`. Bootstrap is not run by CI.

## Consequences

- One manual, auditable step before the first automated deploy.
- The state and artifacts buckets and the OIDC roles are created outside the deployment's
  lifecycle, so a bad `terraform destroy` in the main stack cannot remove them.
- Bootstrap state loss would require re-import; the outputs are recorded in the operator
  runbook.
- CI never needs long-lived AWS credentials.

## Rejected options

- A second pre-created state bucket: more manual work with no benefit at this scale.
- Terraform Cloud: adds a vendor and a second credential path for one root module.

## Risk acceptance

The operator accepts the one-time local-state responsibility, mitigated by secure storage and a
recorded output list.
