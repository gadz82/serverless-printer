# Negotiation — Foundations increment

## Recommendation

**Go.** Build kickoff Phase 0–1: the contracts, the domain/worker skeleton, Terraform
bootstrap/module, CI/release pipeline and the local LocalStack path. Accept a deterministic
placeholder PDF and SQS-only result delivery for this increment. Real Chromium rendering,
PDF/A, the remaining channels and production operations are explicit next increments.

## Why now

- The specification is detailed and stable enough to freeze a first contract.
- Every later increment depends on the queue → worker → storage → callback path and on a real
  release pipeline; proving them first removes the highest integration uncertainty.
- The greenfield blast radius is low, and the placeholder renderer isolates the one deliberately
  deferred technical risk.

## Options and trade-offs

### Option A — Foundations with a placeholder renderer (recommended)

- **Cost:** 5–7 engineering days; 8–10 prompts.
- **Risk:** medium (OIDC/bootstrap), low for the local path.
- **Reversibility:** high.
- **Business impact:** callers get a stable contract and a working async path sooner; output is
  not yet production-grade PDF rendering. PDF/A requests are rejected with
  `PDFA_LEVEL_NOT_ALLOWED` until Phase 3, rather than silently downgraded.

### Option B — Include Chromium and PDF/A now

- **Cost:** roughly doubles the increment.
- **Risk:** high — Chromium packaging, Lambda x86_64, font/PDF/A fidelity and render regression
  all arrive before the foundation is proven.
- **Reversibility:** medium.
- **Business impact:** delays the first caller-visible contract and deploy path.

### Option C — Build all five delivery channels now

- **Cost:** +2–3 prompts.
- **Risk:** medium — HTTP SSRF/allowlist and cross-account permissions need focused review.
- **Business impact:** little value until the core path is stable; the contract already models
  the channels.

### Option D — Use pdf-lib for the placeholder instead of a dependency-free PDF

- **Cost:** one runtime dependency and an ADR.
- **Risk:** low, but it blurs the Phase 1/Phase 3 boundary.
- **Business impact:** none.
- **Decision:** keep the placeholder dependency-free; `pdf-lib` enters with PDF/A in Phase 3.

### Option E — Bootstrap with a remote backend instead of local state

- **Cost:** extra bootstrap bucket/manual step.
- **Risk:** low, but more moving parts before the first apply.
- **Business impact:** none.
- **Decision:** bootstrap uses local state once; the main deployment uses the created S3 backend
  with native locking (ADR-004).

## Customer impact in plain language

There are no existing customers. This increment gives caller teams the first public contract and
a deployable service that returns a placeholder PDF. It does **not** yet render production
templates or PDF/A. A caller who relies on the placeholder output for real business documents
would be disappointed; the next increment replaces it behind the same contract.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| First cloud deploy blocked by missing repo/account inputs | Parameterize everything; local and CI verification; record A-001–A-004 |
| OIDC trust or IAM too broad | Narrow resource scopes and trust conditions; review at G3 |
| Placeholder mistaken for production rendering | Explicit scope, ADR-003, release notes and result docs |
| Unsupported channels accepted silently | Reject with `CALLBACK_NOT_ALLOWED` and name the channel |
| LocalStack/AWS divergence | Deployed smoke is the release authority |
| Contract churn after first callers | Versioned schemas and generated types; breaking changes need a major and an ADR |

## Scope acceptance

- Accepted: R-001–R-012 and scenarios S-001–S-023.
- Clarified: `_smoke` is the single reserved internal slug (ADR-006), and PDF/A requests are
  rejected with `PDFA_LEVEL_NOT_ALLOWED` in Phase 1 (ADR-003).
- Deferred with recorded risk: A-001–A-004.
- Excluded: template tooling/content, Chromium, PDF/A, non-SQS channels, ping/allowlist
  enforcement, load testing, production alarms/runbook, and everything in PRD non-goals.

## Decision requested

Approve the foundations scope, the contract design, the five ADRs and the estimate, or name the
changes required. On approval, planning will produce the prompt DAG and cost estimate for G4.

**Go/no-go: GO**, subject to the human decision at G3.
