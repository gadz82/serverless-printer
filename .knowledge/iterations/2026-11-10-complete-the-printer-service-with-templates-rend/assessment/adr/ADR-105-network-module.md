# ADR-105 — Optional network module with none, create and lookup modes

- Status: proposed
- Date: 2026-11-10
- Deciders: DEVOPS, ARCHITECT, human release owner
- Related: R-106, S-112–S-114

## Context

The spec keeps networking optional: `none` by default, or a created/looked-up VPC for private HTTP
callbacks, with optional endpoints and NAT. The Phase 1 module only supports `none`.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| `modules/network` with three modes (chosen) | Medium | Medium | High | Covers private callbacks without forcing a VPC |
| Always create a VPC | Medium | High cost | Medium | Changes the default and adds NAT/endpoint cost |
| Keep only `none` | Low | Spec incomplete | High | Private HTTP callbacks unsupported |

## Decision

Add `infra/modules/network` supporting `create` (VPC, private subnets, optional public subnets/NAT,
S3 gateway endpoint, SQS/Lambda/Events interface endpoints) and `lookup` (existing VPC by id/tags
and subnets by id/tags). The printer module attaches the worker only when a VPC is selected;
`none` remains the default and creates nothing.

## Consequences

- Private HTTP callbacks are possible without changing the default deployment.
- NAT and interface endpoints add cost; the README documents the trade-off.
- Terraform tests/plans cover all three modes; `none` remains the safest default.

## Rejected options

- Always VPC: unnecessary cost and risk for the common case.
- None-only: leaves R-106 and private callbacks unsatisfied.

## Risk acceptance

Network cost/apply risk is accepted and mitigated by default-off, plan review and documented
inputs.
