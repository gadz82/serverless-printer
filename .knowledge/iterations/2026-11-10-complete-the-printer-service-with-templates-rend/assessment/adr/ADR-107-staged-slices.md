# ADR-107 — Deliver the remaining spec in three staged slices

- Status: proposed
- Date: 2026-11-10
- Deciders: PM, TECH_LEAD, human release owner
- Related: R-101–R-115, A-105

## Context

The remaining specification is roughly three phases and an estimated 19 prompts / ~600k build
tokens before review overhead. The configured per-iteration stop is 600k. A single iteration would
be forced to split or run with `--force`, and would delay the first real template and cloud
feedback.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Three staged slices (chosen) | ~180k + ~260k + ~160k | Medium | High | Each slice demoable and reviewable |
| All remaining work in one iteration | ~600k+ | High | Low | Long delay, forced split likely |
| Chromium-first | ~260k | High | Medium | No real templates to render |

## Decision

Deliver **Slice 1 (templates + network)** in this iteration. Plan **Slice 2 (Chromium/PDF-A/all
channels)** and **Slice 3 (capacity/operations/cloud verification)** as follow-up iterations in the
same repository. The PRD/TRD keep the full remaining scope; closure of Slice 1 records Slices 2–3
as explicit follow-ups.

## Consequences

- Slice 1 fits the budget and produces a real, previewable template plus network support.
- Chromium and PDF/A land next, then operations and the first cloud release.
- The human can override and request one large iteration, accepting the budget/risk.

## Rejected options

- One large iteration: budget and feedback risk.
- Chromium-first: no templates to render.

## Risk acceptance

The human accepts the staged plan at G3; a later change reopens the plan.
