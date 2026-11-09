---
id: architecture-event-driven
title: Event-driven architecture preset
summary: Events are versioned facts with idempotent consumers and explicit failure handling.
kind: architecture
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [architecture, events, messaging, outbox, idempotency]
examples:
  - { path: ../examples/typescript/presets/architecture-event-driven/order-events.ts, title: "TypeScript events", language: typescript }
  - { path: ../examples/python/presets/architecture-event-driven/order_events.py, title: "Python events", language: python }
  - { path: ../examples/java/presets/architecture-event-driven/OrderEvents.java, title: "Java events", language: java }
  - { path: ../examples/go/presets/architecture-event-driven/order_events.go, title: "Go events", language: go }
  - { path: ../examples/ruby/presets/architecture-event-driven/order_events.rb, title: "Ruby events", language: ruby }
  - { path: ../examples/php/presets/architecture-event-driven/OrderEvents.php, title: "PHP events", language: php }
  - { path: ../examples/rust/presets/architecture-event-driven/order_events.rs, title: "Rust events", language: rust }
---
# Rule

Use events when a business fact must be broadcast without coupling the producer to every
consumer. An event is a stable, versioned fact in the past tense, not an RPC. Define ownership,
delivery, ordering, schema evolution, duplicates, and failure before the producer.

# When to use

- A business fact has multiple independent consumers, and eventual consistency has an observable failure path.

# Conflicts

Do not enable with another architecture preset; a request/response-only preset contradicts the event-first boundary.

# Adds to the defaults

Default `architecture-boundaries` keeps I/O at the edge; this preset adds an event catalogue,
schema versioning, an outbox, idempotent consumers, and a dead-letter path.

# Checks

- Each event has an owner, schema version, and compatibility policy.
- Consumers are idempotent and tolerate duplicate or out-of-order delivery.
- The producer uses an outbox or an equivalent atomic publish strategy.
- Failures reach a dead-letter path with replay and ownership.
- Payloads contain stable identifiers and do not leak persistence models.
- Observability traces the event from producer to terminal consumer.

# Evidence

Record the event catalogue, delivery guarantee, schema version, idempotency key, and failure path in assessment and review; include duplicate-delivery and dead-letter tests.

# Example fit

Use the TypeScript, Python, Java, Go, Ruby, PHP, or Rust example to check the versioned fact
and idempotent consumer; the in-memory store is illustrative, not a production outbox.
