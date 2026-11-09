---
id: code-examples
title: Code examples are executable contracts
summary: Examples are small, current, runnable illustrations of the desired style and boundaries.
kind: example
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [examples, style, snippets, tests, cross-language]
examples:
  - path: ../examples/typescript/domain-service.ts
    title: "Domain service with an explicit port"
    language: typescript
  - path: ../examples/typescript/hexagonal-port.ts
    title: "Port and adapter boundary"
    language: typescript
  - path: ../examples/typescript/domain-service.test.ts
    title: "Test at the domain boundary"
    language: typescript
  - path: ../examples/go/domain_service.go
    title: "Go domain service with a repository port"
    language: go
  - path: ../examples/python/domain_service.py
    title: "Python domain service with a protocol"
    language: python
  - path: ../examples/php/DomainService.php
    title: "PHP domain service with a repository interface"
    language: php
  - path: ../examples/rust/domain_service.rs
    title: "Rust domain service with a trait"
    language: rust
  - path: ../examples/java/DeactivateUser.java
    title: "Java domain service with an interface"
    language: java
  - path: ../examples/ruby/domain_service.rb
    title: "Ruby domain service with dependency injection"
    language: ruby
---
# Rule

Examples show the **shape** of acceptable code in the project’s actual language. They are not
copy-paste inventory, and they are not a substitute for the constitution. The shipped examples
cover TypeScript, Go, Python, PHP, Rust, Java, and Ruby; use the closest one and adapt its
idioms. Every example must:

- be small enough to read in one screen and compile, or be explicitly labelled as pseudocode;
- show the boundary, the error path, the test seam, and the project’s real names;
- remain current when the rule, API, or pattern changes.

Prefer one complete example over many fragments, and link it from the discovery or planning artifact.
Preset-specific snippets under `examples/<language>/presets/` and style exemplars follow the same contract.

Project-specific examples live under `.orchid/steering/examples/` and are linked by a project
`code-examples` override. When present, they are binding: Build and code review must follow the
example for the language, and a deviation requires an ADR. During migration, the agent proposes
examples for every significant language and writes them only after explicit human approval.

# Why

A stale or decorative example teaches a shape that no longer compiles or matches the contract.
Because this rule is blocking, an approved project example is the reviewable reference, and a
silent deviation is a finding.

# Checks

- The example demonstrates the rule rather than restating it.
- It shows failure handling, not only the happy path.
- The change follows the project-specific example for its language; every deviation has an ADR.

# Evidence

- Discovery: which examples inform the requirement or acceptance criteria.
- Planning and Build: examples cited in prompt constraints and the project example applied.
- Code review: comparison against the project example, not visual similarity alone.
- Logic review: examples still describe the delivered behaviour.

# Exceptions

An example may be incomplete only when labelled as a sketch, never as positive evidence; a
blocking deviation needs a human-approved ADR.

# Example fit

The shipped set is `../examples/typescript/domain-service.ts` and `hexagonal-port.ts` plus the
Go, Python, PHP, Rust, Java, and Ruby equivalents; `domain-service.test.ts` shows the test seam.
A project override's language example is the binding fit; the shipped example is the fallback.
