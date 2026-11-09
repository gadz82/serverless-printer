---
id: architecture-ddd
title: Domain-driven design preset
summary: Model bounded contexts, aggregates, and ubiquitous language explicitly.
kind: architecture
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [architecture, ddd, aggregates, bounded-contexts]
examples:
  - { path: ../examples/typescript/presets/architecture-ddd/order-aggregate.ts, title: "TypeScript DDD", language: typescript }
  - { path: ../examples/python/presets/architecture-ddd/order_aggregate.py, title: "Python DDD", language: python }
  - { path: ../examples/java/presets/architecture-ddd/OrderAggregate.java, title: "Java DDD", language: java }
  - { path: ../examples/go/presets/architecture-ddd/order_aggregate.go, title: "Go DDD", language: go }
  - { path: ../examples/ruby/presets/architecture-ddd/order_aggregate.rb, title: "Ruby DDD", language: ruby }
  - { path: ../examples/php/presets/architecture-ddd/OrderAggregate.php, title: "PHP DDD", language: php }
  - { path: ../examples/rust/presets/architecture-ddd/order_aggregate.rs, title: "Rust DDD", language: rust }
---
# Rule

Use domain-driven design when complexity is in the business model, not the framework. Define
bounded contexts, ubiquitous language, aggregates with invariants, domain events, and
domain-owned repositories. Do not create a repository or aggregate for every table; start from
the invariant and consistency boundary.

# When to use

- Business rules are more complex than the delivery mechanism, and invariants need a consistency boundary.

# Conflicts

Do not enable with hexagonal, onion, clean, CQRS, or event-driven presets; they compete for one vocabulary.

# Adds to the defaults

Default `architecture-boundaries` protects dependency direction; this preset adds bounded
contexts, aggregate invariants, ubiquitous language, and domain-owned repositories.

# Checks

- Each bounded context has a clear owner and language.
- Aggregate boundaries protect invariants and define one consistency boundary.
- Domain types do not depend on ORM rows, transport DTOs, or framework annotations.
- Domain events describe business facts and have an owner.
- Repositories expose domain concepts, not arbitrary query builders.

# Evidence

Record context boundaries, aggregate invariants, and cross-context contracts in assessment and review artifacts; cite the invariant test.

# Example fit

Use the language example to check the invariant and domain event; do not turn every table into
an aggregate.
