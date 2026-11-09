---
id: dependency-inversion-container
title: Dependency inversion and DI containers
summary: Wire dependencies explicitly at the boundary; a container is optional.
kind: architecture
authority: advisory
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [solid, dependency-inversion, dependency-injection, composition, di]
examples:
  - { path: ../examples/typescript/presets/dependency-inversion-container/composition-root.ts, title: "TypeScript composition root", language: typescript }
  - { path: ../examples/python/presets/dependency-inversion-container/composition_root.py, title: "Python composition root", language: python }
  - { path: ../examples/java/presets/dependency-inversion-container/CompositionRoot.java, title: "Java composition root", language: java }
  - { path: ../examples/go/presets/dependency-inversion-container/composition_root.go, title: "Go composition root", language: go }
  - { path: ../examples/ruby/presets/dependency-inversion-container/composition_root.rb, title: "Ruby composition root", language: ruby }
  - { path: ../examples/php/presets/dependency-inversion-container/CompositionRoot.php, title: "PHP composition root", language: php }
  - { path: ../examples/rust/presets/dependency-inversion-container/composition_root.rs, title: "Rust composition root", language: rust }
---
# Rule

Depend on explicit contracts, not on concrete infrastructure. Wire implementations at a
**composition root** so the application does not construct its own database, HTTP client,
clock, or third-party SDK.

A dependency-injection container is one valid way to perform that wiring. It is not mandatory.
Constructor injection, factory functions, module wiring, or explicit configuration are equally
valid when they keep the graph readable and testable. Do not introduce a container merely to
hide dependency relationships.

# Why

Hidden construction makes tests slow and lifetimes unsafe. Explicit wiring shows the dependency
graph, keeps request state out of singletons, and lets a test replace every external dependency.
A container that hides the graph trades one problem for another.

# Checks

- The dependency graph is assembled at an explicit composition root.
- Application and domain units receive collaborators; they do not fetch them from ambient state.
- A container, if used, has explicit lifetimes and scope; no captured request state in singletons.
- No service-locator pattern hides dependencies behind a global registry.
- Interfaces are owned by the consumer side where that keeps the contract focused.
- Tests can replace every external dependency with a deterministic double.
- A new container or framework wiring choice is recorded in the assessment artifact.
- Circular dependencies are rejected or resolved through an explicit boundary, not lazy loading.

# Evidence

Record the composition root, injected contracts, lifetimes, and test replacements in
`assessment/steering.md` and `reviews/steering-review.md`. If the project uses no container,
state how wiring is done instead.

# Exceptions

A framework-managed container is acceptable when the framework owns the lifecycle. Name the
scope boundary and the tests that prove request state is not shared accidentally. A deviation
from this advisory rule is recorded in the phase artifact; a public contract change still needs
an ADR.

# Example fit

`../examples/typescript/domain-service.ts` uses constructor injection. `../examples/typescript/hexagonal-port.ts`
shows the in-memory adapter. `../examples/typescript/domain-service.test.ts` replaces the port
without a container. The preset examples in TypeScript, Python, Java, Go, Ruby, PHP, and Rust
show the explicit wiring root. Use them to prove that a container is optional, not to add one by
default.
