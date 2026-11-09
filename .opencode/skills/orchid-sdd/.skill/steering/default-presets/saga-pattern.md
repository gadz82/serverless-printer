---
id: saga-pattern
title: SAGA pattern for distributed transactions
summary: Multi-service business transactions need explicit steps, compensation, and idempotency.
kind: architecture
authority: advisory
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [saga, distributed-transactions, compensation, idempotency, events]
examples:
  - { path: ../examples/typescript/presets/saga-pattern/order-saga.ts, title: "TypeScript SAGA", language: typescript }
  - { path: ../examples/python/presets/saga-pattern/order_saga.py, title: "Python SAGA", language: python }
  - { path: ../examples/java/presets/saga-pattern/OrderSaga.java, title: "Java SAGA", language: java }
  - { path: ../examples/go/presets/saga-pattern/order_saga.go, title: "Go SAGA", language: go }
  - { path: ../examples/ruby/presets/saga-pattern/order_saga.rb, title: "Ruby SAGA", language: ruby }
  - { path: ../examples/php/presets/saga-pattern/OrderSaga.php, title: "PHP SAGA", language: php }
  - { path: ../examples/rust/presets/saga-pattern/order_saga.rs, title: "Rust SAGA", language: rust }
---
# Rule

Use a SAGA when one business transaction spans multiple services, databases, or asynchronous
steps where a single local transaction is impossible. A SAGA is a sequence of local
transactions with a defined compensation path, not a distributed ACID transaction.

The rule is **not applicable** when the change stays inside one transactional boundary. State
that explicitly in the phase artifact rather than inventing a SAGA.

# Why

A multi-service transaction without compensation leaves partial state that no rollback can
repair. Without idempotency and persistent progress, a retry duplicates side effects and a crash
loses the recovery point. The rule makes the consistency window and the failure path visible
before implementation.

# Checks

- The trigger and the services or steps spanned by the SAGA are named.
- Every step has an owner, a local transaction, and a compensating action or a documented reason
  it cannot be compensated.
- Steps are idempotent; a retry cannot duplicate a side effect.
- The SAGA has persistent state or a reliable event log; progress is recoverable after a crash.
- Timeouts, dead-letter handling, and a human escalation path exist for terminal failure.
- Ordering, duplicate delivery, partial failure, and concurrent execution have tests.
- Events and payloads are versioned and observable.
- The design states orchestration or choreography and why.
- The user has accepted the consistency window and visible intermediate states.

# Evidence

Record the trigger, steps, compensations, state owner, idempotency strategy, timeout policy,
and observability in `discovery/steering.md`, `assessment/steering.md`, and
`reviews/steering-review.md`. Include failure-path tests, not only the happy path.

# Exceptions

A compensating action that cannot exist needs an ADR with the customer-visible state, the
recovery plan, and human acceptance. Staying inside one transactional boundary is not an
exception; it is the reason the rule is not applicable.

# Example fit

The preset examples in TypeScript, Python, Java, Go, Ruby, PHP, and Rust show persistent state,
idempotency keys, and a compensation path. Use `../examples/typescript/domain-service.ts` only
for the single-transaction boundary case; do not treat the local domain service as a SAGA template.

# Discovery questions

- Which services or data stores must agree, and what is the cost of a temporary mismatch?
- Which step can fail after a side effect, and what compensates it?
- Who owns recovery when the flow reaches a terminal state?
