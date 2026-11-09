---
id: logic-review-steering
title: Apply steering during logic review
summary: Verify every active steering rule against the integrated behaviour before G6.
kind: process
authority: blocking
phases: [logic_review]
tags: [logic-review, compliance, evidence, gate]
---
# Rule

Logic review is the last semantic check before closure. The PM must verify the delivered
behaviour against every active steering rule, not only the PRD and Gherkin. A rule is satisfied
only when the review names the evidence; the absence of a finding is not evidence.

Style and architecture checks may be delegated to the specialists who reviewed the build, but
the PM owns the final statement that the evidence exists and is current for the integration
branch. A blocking rule with no evidence stops G6.

# Why

Evidence from a local branch can be stale by the time the integration branch is reviewed. A
per-rule verdict prevents a passing test suite from hiding an unverified boundary, style gate,
or repository exception, and makes every waiver a decision rather than a silent gap.

# Checks

- `steering context --phase logic_review` and every referenced rule file are read.
- Each active rule has a verdict: `satisfied`, `not applicable`, `finding`, or `waived`.
- Each verdict cites file paths, symbols, commands, ADR IDs, and a commit or diff reference.
- Style gates ran on the integrated change, not only on a local branch.
- Architecture dependencies still point inward and no new boundary was crossed.
- Every touched cross-repo dependency row is verified or waived with current evidence.
- The repository flow was followed and no unreviewed direct merge occurred.
- Delivered code still matches the approved examples, or a deviation is recorded.
- Every open finding becomes a follow-up prompt or a waived risk with an ADR.
- `reviews/steering-review.md` is written and usable as G6 evidence.

# Evidence

`reviews/steering-review.md` records rule ID, verdict, current evidence, and owner for the
integration target. A rule with no verdict or stale evidence is treated as unmet.

# Exceptions

A waiver names the rule, reason, owner, blast radius, and expiry, and is approved by the human
owner in an ADR. Advisory deviations may be reported as recommendations.

# Gate

Do not pass G6 while a blocking steering rule is `finding` or has no verdict. Advisory rules may
be reported with a recommendation, but a pattern of ignored advisory findings belongs in the
follow-up iteration.

# Example fit

Use `architecture-boundaries` with `../examples/typescript/hexagonal-port.ts`: a satisfied
verdict cites the changed import boundary and the test that replaces the adapter. If the change
imports the adapter into the domain, the verdict is `finding` with the file and symbol, not a
note to fix later.
