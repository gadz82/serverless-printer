---
id: P-001
type: build
title: <reviewable outcome>
wave: 1
depends_on: []
personas: [DEV, QE]
scope:
  write: []
  read: []
deliverables:
  code: []
  tests:
    unit: []
    integration: []
    e2e: []
acceptance: []
memory_refs: []
constitution_refs: []
dependency_refs: []
estimate: S
---

# Task
One reviewable outcome. State the behaviour, not the implementation.

# Constraints
Patterns, contracts, and invariants that must hold. Keep inline comments why-only; put history
and decisions in the UUID docblock behind the `ORCHID-MEM` anchor.

# Out of scope
Work that belongs to another prompt.

# Report back
Write blockers and interface changes to `plan/prompts/_bus/outbox/P-001/`.
