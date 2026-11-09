---
id: architecture-boundaries
title: Architecture boundaries
summary: Domain and application code stay independent of frameworks, transport, persistence, and UI.
kind: architecture
authority: blocking
phases: [discovery, assessment, planning, build, code_review, logic_review]
tags: [architecture, boundaries, dependencies, ports]
examples:
  - path: ../examples/typescript/hexagonal-port.ts
    title: "Port and adapter boundary"
    language: typescript
  - path: ../examples/typescript/domain-service.ts
    title: "Domain service using a port"
    language: typescript
---
# Rule

The dependency direction is **inward**:

```text
UI / transport / persistence  →  application  →  domain
```

Domain code must not import frameworks, HTTP clients, ORMs, database drivers, UI libraries, or
provider SDKs. Application code may orchestrate domain behavior through explicit ports.
Adapters implement those ports and contain all I/O.

The choice of hexagonal, onion, or clean architecture is a project decision, not a licence to
mix them. If the project selects a named pattern, enable its preset rule and keep one
vocabulary for layers and boundaries.

# Why

A boundary without an explicit contract turns every framework change into a domain change. The
rule keeps the domain testable without a server or database and limits the blast radius of
transport, persistence, and vendor choices. It also makes the cost of a new dependency visible
at review time.

# Checks

- Each crossed boundary is named with the contract that guards it.
- New domain code has no framework, transport, persistence, or vendor imports.
- Adapters depend on ports; no port imports an adapter.
- Cross-boundary data uses explicit types, not ORM rows or ad-hoc maps.
- No business rule lives in a controller, migration, UI component, or job handler.
- A new boundary names the port, the adapter, and the owner.
- In workspace mode, each touched cross-repo edge has a `DEP-###` row with current consumer/provider evidence.

# Evidence

- Discovery: affected boundaries, ports, and constraints in `discovery/steering.md`.
- Assessment: boundary decision and ADR reference in `assessment/steering.md`.
- Code review: file and symbol evidence in `reviews/steering.md`.
- Workspace: dependency ledger rows and consumer/provider regression tests.
- Logic review: confirm behaviour crosses boundaries only through the agreed contracts.

# Exceptions

A deliberate deviation needs an ADR naming the rule, reason, blast radius, owner, and review
date. The human owner approves it; one prompt's exception is not a precedent.

# Example fit

`../examples/typescript/hexagonal-port.ts` shows a domain-owned port and an in-memory adapter.
`../examples/typescript/domain-service.ts` shows a use case that depends on the port, not the
database, and has an explicit not-found failure. `../examples/typescript/domain-service.test.ts`
replaces the adapter without a server. Use the closest language example; do not copy its
structure blindly.

# Discovery questions

- Which boundary does this requirement touch?
- Is the required contract already represented as a port or public type?
- Does the requirement force a framework concern into the domain?
- Which existing adapter or consumer will need to change?
