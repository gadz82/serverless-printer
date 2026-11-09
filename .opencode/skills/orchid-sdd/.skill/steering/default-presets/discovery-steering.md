---
id: discovery-steering
title: Apply steering during discovery
summary: Turn steering constraints into requirements, questions, and acceptance evidence before G2.
kind: process
authority: blocking
phases: [discovery]
tags: [discovery, requirements, gherkin, constraints]
---
# Rule

Discovery is where steering becomes testable. The PM must read every active rule before
finalizing requirements and must convert each applicable rule into one of:

- a requirement or Gherkin acceptance criterion;
- a question in the questionnaire;
- a documented assumption with risk;
- an explicit ADR-backed exception.

A rule that is not applicable must say why. “Not applicable” without a reason is not evidence.
Discovery does not review implementation style; it records the constraints that later phases
will verify.

# Why

A project decision that never reaches a requirement or scenario disappears before Build.
Converting steering at discovery makes the constraint testable, gives assessment the right
questions, and prevents a late architecture or style surprise from reopening scope.

# Checks

- `steering context --phase discovery` and every referenced rule file are read.
- Each applicable rule is mapped to a requirement, scenario, question, assumption, or ADR-backed exception.
- Each non-applicable rule has a written reason.
- Rule IDs appear in the relevant requirement, scenario, or questionnaire.
- Deferred decisions have an assumption, risk, and detection point.
- `discovery/steering.md` records rule ID, applicability, constraint, evidence, and owner.
- No technical solution is invented in a PM-owned discovery artifact.

# Evidence

`discovery/steering.md` is the phase artifact. It must let a reviewer map a requirement to a
rule and see the planned proof. The discovery gate may cite it as G2 evidence.

# Exceptions

A blocking rule may be waived only by an ADR approved by the human owner, with the rule, reason,
blast radius, and review date. An inapplicable rule needs a reason, not a waiver.

# Example fit

Use `architecture-boundaries` with `../examples/typescript/hexagonal-port.ts` as a worked
mapping: a requirement that changes user deactivation touches the `UserRepository` port, the
in-memory adapter is illustrative, and the planned evidence is a domain-service test. Record
that row in `discovery/steering.md`.
