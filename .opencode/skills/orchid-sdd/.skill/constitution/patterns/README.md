# Patterns

Prefer one established pattern per concern. Reuse the pattern already used at the boundary; a second pattern needs an ADR that names the boundary, the migration path, and the owner.

## Boundaries

- Keep transport, domain, and persistence concerns separate.
- Depend inward: domain code does not import transport or framework code.
- Put cross-cutting behaviour (auth, logging, retries) in one explicit layer.
- Pass explicit types across a boundary, not ORM rows, HTTP models, or ad-hoc maps.

## Composition

- Prefer constructor or parameter injection over hidden globals.
- Keep side effects at the edges; pure logic in the middle.
- Wire the graph at one composition root and hide storage details.

## Reversibility

- Isolate risky integrations behind an interface.
- Feature-flag behaviour that changes customer-visible flows.
- Make migrations forward-only *and* provide a rollback script.

## Anti-patterns

- A second pattern because it is locally convenient.
- An abstraction with no current consumer.
- A shared utility layer that hides a cross-module dependency.
- A rollback plan that has never been run.

## Evidence

- Assessment: pattern choice, boundary, options, and ADR.
- Code review: imports, dependency direction, and contract tests.
- Logic review: behaviour still crosses the boundary through the agreed contract.

## Exceptions

A deliberate deviation needs an ADR with the rule, reason, blast radius, and review date. A one-off exception does not become a precedent.
