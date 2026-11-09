---
id: architecture-hexagonal
title: Hexagonal architecture preset
summary: Domain and application at the centre; ports and adapters at every edge.
kind: architecture
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [architecture, hexagonal, ports, adapters]
examples:
  - { path: ../examples/typescript/hexagonal-port.ts, title: "TypeScript port", language: typescript }
  - { path: ../examples/python/presets/architecture-hexagonal/confirm_order.py, title: "Python confirm order", language: python }
  - { path: ../examples/java/presets/architecture-hexagonal/ConfirmOrder.java, title: "Java confirm order", language: java }
  - { path: ../examples/go/presets/architecture-hexagonal/confirm_order.go, title: "Go confirm order", language: go }
  - { path: ../examples/ruby/presets/architecture-hexagonal/confirm_order.rb, title: "Ruby confirm order", language: ruby }
  - { path: ../examples/php/presets/architecture-hexagonal/ConfirmOrder.php, title: "PHP confirm order", language: php }
  - { path: ../examples/rust/presets/architecture-hexagonal/confirm_order.rs, title: "Rust confirm order", language: rust }
---
# Rule

Use **ports and adapters** as the architecture vocabulary. The domain holds business rules;
application services orchestrate use cases; ports are owned by the inside; adapters implement I/O
and third-party services. The goal is replaceable contracts and a framework-free domain.

# When to use

- The domain must stay testable without a server or database, and multiple adapters share the same use-case layer.

# Conflicts

Do not enable with clean, onion, DDD, CQRS, or event-driven presets; they compete for one vocabulary.

# Adds to the defaults

Default `architecture-boundaries` requires inward dependencies; this preset adds port ownership, adapter boundaries, a composition root, and a test seam.

# Checks

- Each use case has a clear input and output contract.
- Persistence and transport types do not leak into the domain.
- Adapters are replaceable in tests; a new dependency enters at an adapter, not inside the domain.
- Ports are named after behaviour, not technology.

# Evidence

Cite the port, adapter, and use-case path in assessment and review artifacts; confirm the example resolves.

# Example fit

Use the TypeScript, Python, Java, Go, Ruby, PHP, or Rust example to check the port/adapter
split; the in-memory adapter is illustrative.
