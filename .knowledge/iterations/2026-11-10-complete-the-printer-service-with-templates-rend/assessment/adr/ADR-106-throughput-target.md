# ADR-106 — Capacity starts from a candidate throughput target

- Status: proposed
- Date: 2026-11-10
- Deciders: PM, TECH_LEAD, DEVOPS, human release owner
- Related: R-112, S-124

## Context

`SPEC.md` leaves the throughput target open. Memory, concurrency and the load test need a target
before Slice 3.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Candidate target: 10 jobs/min peak, 20-page documents, p95 < 30 s (chosen for planning) | Medium | Medium | High | Concrete capacity and load test |
| No target until production | Low | High | High | Untestable capacity |
| Overprovision for 100 jobs/min | High cost | Low latency risk | Medium | Unnecessary spend |

## Decision

Use the candidate target for planning and load-test design: 10 jobs/min peak, a 1-page/20-page mix,
and p95 under 30 seconds, measured with and without PDF/A. Start the worker at 1,536 MB, run Lambda
Power Tuning, and set `maximum_concurrency`/reserved concurrency from the evidence. The human
confirms or changes the target before the Slice 3 load test.

## Consequences

- Capacity work has a concrete, testable target.
- The load test records throughput, p95, errors and memory for the README/runbook.
- A different production target may require a follow-up tuning pass.

## Rejected options

- No target: cannot size or verify.
- Overprovision: cost without evidence.

## Risk acceptance

The candidate target is explicitly provisional until the human confirms it.
