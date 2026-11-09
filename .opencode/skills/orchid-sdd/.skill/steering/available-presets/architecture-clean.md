---
id: architecture-clean
title: Clean architecture preset
summary: Use-case-centric layers with framework-independent entities and explicit boundaries.
kind: architecture
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [architecture, clean, use-cases, boundaries]
examples:
  - { path: ../examples/typescript/presets/architecture-clean/place-order.ts, title: "TypeScript clean use case", language: typescript }
  - { path: ../examples/python/presets/architecture-clean/place_order.py, title: "Python clean use case", language: python }
  - { path: ../examples/java/presets/architecture-clean/PlaceOrder.java, title: "Java clean use case", language: java }
  - { path: ../examples/go/presets/architecture-clean/place_order.go, title: "Go clean use case", language: go }
  - { path: ../examples/ruby/presets/architecture-clean/place_order.rb, title: "Ruby clean use case", language: ruby }
  - { path: ../examples/php/presets/architecture-clean/PlaceOrder.php, title: "PHP clean use case", language: php }
  - { path: ../examples/rust/presets/architecture-clean/place_order.rs, title: "Rust clean use case", language: rust }
---
# Rule

Organize around **entities and use cases**. Entities hold enterprise rules; use cases orchestrate
application behavior; adapters translate external formats. Dependencies point toward the center.

# When to use

- Business behaviour is naturally expressed as explicit use cases shared by several delivery mechanisms.

# Conflicts

Do not enable with hexagonal, onion, DDD, CQRS, or event-driven presets; they compete for the
architecture vocabulary.

# Adds to the defaults

Default `architecture-boundaries` requires inward dependencies; this preset adds named entities,
use-case contracts, interface adapters, and a use-case test seam.

# Checks

- Use cases are explicit and independently testable.
- Entities do not import frameworks, UI, databases, or transport code.
- Adapters own DTOs, presenters, and framework translation.
- Dependency inversion is used where the inner layer needs an outer capability.
- No parallel layers or duplicate contracts are introduced.

# Evidence

Record the use-case path, adapter mapping, and test seam in `assessment/steering.md` and
`reviews/steering-review.md`.

# Example fit

Use the TypeScript, Python, Java, Go, Ruby, PHP, or Rust example to check the use-case boundary and
test seam; keep entities free of transport and persistence code.
