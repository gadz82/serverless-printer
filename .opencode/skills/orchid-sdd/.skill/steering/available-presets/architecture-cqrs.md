---
id: architecture-cqrs
title: CQRS preset
summary: Separate command and query responsibilities where their models genuinely differ.
kind: architecture
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [architecture, cqrs, commands, queries, read-models]
examples:
  - { path: ../examples/typescript/presets/architecture-cqrs/orders.ts, title: "TypeScript CQRS", language: typescript }
  - { path: ../examples/python/presets/architecture-cqrs/orders.py, title: "Python CQRS", language: python }
  - { path: ../examples/java/presets/architecture-cqrs/Orders.java, title: "Java CQRS", language: java }
  - { path: ../examples/go/presets/architecture-cqrs/orders.go, title: "Go CQRS", language: go }
  - { path: ../examples/ruby/presets/architecture-cqrs/orders.rb, title: "Ruby CQRS", language: ruby }
  - { path: ../examples/php/presets/architecture-cqrs/Orders.php, title: "PHP CQRS", language: php }
  - { path: ../examples/rust/presets/architecture-cqrs/orders.rs, title: "Rust CQRS", language: rust }
---
# Rule

Use CQRS only when commands and queries need different models, scaling, or consistency
guarantees. A command changes state and returns an acknowledgement or identifier; a query reads
a projection and must not mutate domain state. Prefer a single model when read and write needs align.

# When to use

- Read and write models have different shapes, volumes, or performance needs, and the consistency window is explicit.

# Conflicts

Do not enable with another architecture preset. A single-model preset contradicts the split, and
a second architecture vocabulary makes the boundary ambiguous.

# Adds to the defaults

Default `architecture-boundaries` separates domain from transport and persistence; this preset
adds separate command and query contracts, read-model freshness, and a consistency window.

# Checks

- Commands validate intent and enforce invariants in one write boundary.
- Queries do not trigger lazy writes, side effects, or hidden state changes.
- Read models state their source, freshness, and rebuild strategy.
- Eventual consistency is visible to users and covered by tests.

# Evidence

Record why the split is needed, the read-model freshness expectation, and the consistency window
in `assessment/steering.md` and `reviews/steering-review.md`.

# Example fit

Use the TypeScript, Python, Java, Go, Ruby, PHP, or Rust example to check that the write path
and read path do not share mutable state; the query must still work when the projection is
rebuilt.
