---
id: architecture-onion
title: Onion architecture preset
summary: Concentric layers with domain at the centre and dependencies pointing inward.
kind: architecture
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [architecture, onion, layers, dependencies]
examples:
  - { path: ../examples/typescript/presets/architecture-onion/cancel-order.ts, title: "TypeScript onion", language: typescript }
  - { path: ../examples/python/presets/architecture-onion/cancel_order.py, title: "Python onion", language: python }
  - { path: ../examples/java/presets/architecture-onion/CancelOrder.java, title: "Java onion", language: java }
  - { path: ../examples/go/presets/architecture-onion/cancel_order.go, title: "Go onion", language: go }
  - { path: ../examples/ruby/presets/architecture-onion/cancel_order.rb, title: "Ruby onion", language: ruby }
  - { path: ../examples/php/presets/architecture-onion/CancelOrder.php, title: "PHP onion", language: php }
  - { path: ../examples/rust/presets/architecture-onion/cancel_order.rs, title: "Rust onion", language: rust }
---
# Rule

Use **concentric layers**: domain model, domain services, application services, and
infrastructure outside. Dependencies point inward; outer layers may depend on inner layers, and
inner layers know nothing about outer layers. A layer exists only if it owns a distinct
responsibility and a contract.

# When to use

- The team uses layer vocabulary and needs the inward dependency rule enforced.

# Conflicts

Do not enable with hexagonal or clean presets; they describe the same boundary with different names, and a second architecture preset splits the vocabulary.

# Adds to the defaults

Default `architecture-boundaries` requires inward dependencies; this preset names layer
responsibilities and the contract each outer layer must use.

# Checks

- Domain types and rules have no infrastructure imports.
- Application services depend on interfaces, not concrete repositories or clients.
- Infrastructure implements the interfaces defined by inner layers.
- Cross-layer calls use explicit contracts and do not pass ORM/HTTP models inward.
- Tests can exercise domain and application behavior without infrastructure.

# Evidence

Record the layer and dependency decision in assessment and review artifacts; if hexagonal terminology is used, pick one vocabulary.

# Example fit

Use the language example to check the inward dependency and replaceable adapter; do not add
folder layers without a responsibility.
