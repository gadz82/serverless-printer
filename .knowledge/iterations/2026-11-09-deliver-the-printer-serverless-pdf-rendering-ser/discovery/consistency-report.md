# Discovery consistency report

- Iteration: `2026-11-09-deliver-the-printer-serverless-pdf-rendering-ser`
- Manifest inspected: 12 Requirement nodes (`R-001`–`R-012`)
- Scenarios inspected: `discovery/gherkin/*.feature`

## Result

**No blocking inconsistency found.** Every requirement has at least one scenario; every
scenario carries an `@req` tag; the terminology matches the glossary and the PRD/TRD.

## Checks

| Check | Result | Evidence |
|---|---|---|
| Contradictions between PRD, TRD and Gherkin | None | The iteration boundary (Phase 0–1) is repeated consistently; placeholder rendering and SQS-only delivery are explicit |
| Superseded decisions | None | This is the first iteration; there are no accepted decisions to supersede |
| Breaking change without an ADR | None | There is no existing public contract; the first contract is additive |
| Regressions to existing users | None | Greenfield repository; local behaviour is the only prior behaviour |
| Ambiguous terms | None after glossary | `print`, `job`, `template`, `callback`, `release` and `placeholder renderer` are defined |
| Reserved `_smoke` slug vs public slug regex | Resolved in planning | The spec names `_smoke` by slug while the regex forbids a leading underscore; ADR-006 reserves `_smoke` as the only internal exception |
| Orphan requirements | None | Each `R-###` maps to a scenario in the traceability table below |
| Uncovered scenarios | None | Each scenario names an observable outcome |
| Steering conflicts | None | Hexagonal architecture is the only architecture preset; trunk-based is the only repository preset; saga is explicitly not applicable |
| Scope drift | None | Requirements stay within contracts, skeleton, pipeline, infrastructure, local development and governance |
| Secrets or personal data in knowledge | None | No credentials; the account/repo values are deferred assumptions |

## Requirement-to-scenario traceability

| Requirement | Scenarios |
|---|---|
| R-001 | `job-submission.feature` — one job yields one result; `refId` echoed |
| R-002 | `job-submission.feature` — valid schema; invalid message rejected |
| R-003 | `worker-processing.feature` — stored PDF success; unknown template |
| R-004 | `release-pipeline.feature` — release deploy; sha deploy |
| R-005 | `infrastructure.feature` — bootstrap; printer module |
| R-006 | `ci-quality.feature` — valid PR checks; failing contract/Terraform check |
| R-007 | `local-development.feature` — local success; visible failure in sink |
| R-008 | `worker-processing.feature` — retry then DLQ; last-attempt failure result |
| R-009 | `worker-processing.feature` — one-day expiry and presigned TTL |
| R-010 | `ci-quality.feature` — commitlint rejection; squash/linear history |
| R-011 | `delivery-safety.feature` — allowed senders only; allowed callback targets only |
| R-012 | `release-pipeline.feature` — smoke passes; rollback deploys earlier release |

## Deferred items

- `Q-001` operational prerequisites are recorded as assumptions `A-001`–`A-004`. They block the
  first real deploy, not the product scope or G2.

## Conclusion

The discovery set is internally consistent and ready for the discovery gate.
