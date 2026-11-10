# Negotiation — Finalize rendering, callbacks and production

## Recommendation

**GO** for the final iteration covering Slices 2+3: Chromium, PDF/A, all channels, role modes,
render regression, capacity, operations and the first cloud verification. Plan 12 prompts and split
Slice 3 into a follow-up at G4 only if the cost or AWS prerequisites make it necessary.

## Options

### A — One final iteration, Slices 2+3 (recommended)

- ~420k build + reviews (~480k–500k), under the 600k stop.
- Delivers production rendering and operations together; one closure/handover.
- Risk: Chromium/PDF-A and cloud verification are both large; a split is the fallback.

### B — Split now: Slice 2, then Slice 3

- Slice 2 ~260k, Slice 3 ~160k.
- Safer budget and earlier rendering feedback, but two more iterations/handovers.
- Recommended if the user wants smaller reviews.

### C — Skip PDF/A/all channels

- Not acceptable: leaves SPEC §4.3/§4.5/§5.1 incomplete.

### D — One shared caller/worker role

- Rejected: callers could publish results and the worker could enqueue jobs; violates least
  privilege. Separate generated/provided roles are the design.

## Role ownership

- Both roles default to `create`; `existing` modes accepted.
- Caller: send jobs only; generated trust or provided ARN added to queue senders.
- Worker: consume/publish channels; provided same-account/trust Lambda; bootstrap PassRole.
- Cross-account caller allowed via trust; worker same-account only.
- Provided role permissions are owner-managed and documented.

## Customer impact

Caller teams get production PDFs (optional PDF/A) through any channel; integrators get a generated
caller role or can reuse their own; operators get alarms, a runbook and a verified rollback.

## Risks

| Risk | Mitigation |
|---|---|
| Chromium packaging | Pin, bundle external, render regression, load |
| PDF/A conformance | Best effort, checks, docs |
| SSRF | Allowlist + DNS/link-local tests |
| Provided role trust/PassRole | Same-account/trust validation, bootstrap variable |
| VPC apply | Bootstrap expansion, default none |
| Throughput | Confirm target, Power Tuning, load |
| Budget | Split Slice 3 at G4 if needed |

## Scope acceptance

- R-201–R-218 and S-201–S-219.
- A-201–A-206 remain recorded.
- No shared role; separate caller/worker with generated defaults.

## Decision requested

Approve Slices 2+3 as one final iteration with the separate generated/provided role design, or
choose the two-iteration split.
