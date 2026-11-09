---
id: solid-principles
title: SOLID principles
summary: Keep responsibilities, contracts, and dependencies small and replaceable.
kind: architecture
authority: advisory
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [solid, srp, ocp, lsp, isp, dip, design]
examples:
  - { path: ../examples/typescript/presets/solid-principles/invoice-service.ts, title: "TypeScript SOLID", language: typescript }
  - { path: ../examples/python/presets/solid-principles/invoice_service.py, title: "Python SOLID", language: python }
  - { path: ../examples/java/presets/solid-principles/InvoiceService.java, title: "Java SOLID", language: java }
  - { path: ../examples/go/presets/solid-principles/invoice_service.go, title: "Go SOLID", language: go }
  - { path: ../examples/ruby/presets/solid-principles/invoice_service.rb, title: "Ruby SOLID", language: ruby }
  - { path: ../examples/php/presets/solid-principles/InvoiceService.php, title: "PHP SOLID", language: php }
  - { path: ../examples/rust/presets/solid-principles/invoice_service.rs, title: "Rust SOLID", language: rust }
---
# Rule

Apply SOLID as a set of questions, not as a reason to add layers or abstractions:

- **Single responsibility:** a unit should have one reason to change. “One file” is not the
  same as “one responsibility”.
- **Open/closed:** extend behaviour through explicit extension points, composition, or ports
  rather than editing every caller.
- **Liskov substitution:** an implementation must honour the contract and failure modes of the
  interface it implements. A replacement must not introduce surprise exceptions or weaker
  guarantees.
- **Interface segregation:** prefer small role-specific contracts over one broad interface.
- **Dependency inversion:** high-level policy should not depend on low-level I/O details;
  both should depend on explicit contracts.

An abstraction needs a current consumer and a reason to exist. If it makes the change harder to
read or test, the design is not yet justified.

# Why

SOLID prevents rigid coupling when it is tied to a real variation. Applied as a slogan, it adds
interfaces and layers with no consumer, slows the change, and hides the dependency it was meant
to expose. The checks keep the principle tied to a current need.

# Checks

- Each changed unit can be described by one responsibility.
- A new extension point replaces a known variation, not a hypothetical one.
- Implementations preserve the interface contract, including errors and empty states.
- Interfaces are shaped for their consumers, not copied from a provider API.
- Dependencies are explicit at the boundary, not reached through globals or service locators.
- The design is testable without a real framework, database, or network.
- No new layer or abstraction is added without a current consumer.

# Evidence

Record the affected responsibilities, contracts, and dependency direction in
`discovery/steering.md`, `assessment/steering.md`, and `reviews/steering-review.md`. Mention any
deliberate exception and its reason; do not use SOLID as a slogan.

# Exceptions

A deviation is recorded in the phase artifact with the reason and owner. A structural change or
public contract change still needs an ADR; the advisory authority of this rule does not waive
that requirement.

# Example fit

`../examples/typescript/domain-service.ts` shows a single responsibility and dependency
inversion. `../examples/typescript/hexagonal-port.ts` shows a small consumer-owned interface.
`../examples/typescript/domain-service.test.ts` shows substitutability with an in-memory
adapter. The preset examples in TypeScript, Python, Java, Go, Ruby, PHP, and Rust show the same
shape with a tax policy seam. Use them to justify a current seam, not to add layers.
