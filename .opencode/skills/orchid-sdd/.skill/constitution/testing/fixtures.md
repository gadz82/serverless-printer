# Fixtures and factories

Intent: make test data explicit, deterministic, and safe to share without hiding the case under test.

## Required

- Factories build valid objects by default; tests override only the fields that matter.
- Fixtures are deterministic and contain no production data, real personal data, or real secrets.
- Never share mutable fixtures across tests; create per test or reset explicitly.
- Seed data is explicit, minimal, and named after the scenario it supports.
- Snapshot tests are allowed only for stable, intentional output with a named owner.
- Cleanup is part of the fixture contract; the test proves the cleanup or uses an isolated resource.
- Use fixed clocks, seeded randomness, and stable IDs where the assertion depends on them.
- Keep fixture builders close to the tests that use them unless they are shared intentionally.

## Anti-patterns

- A global fixture that every test mutates.
- A production dump or a real customer record used to make a test realistic.
- A factory that hides required fields behind defaults the test never sees.
- A snapshot accepted without review.
- Cleanup that depends on test order.
- Random data without a seed when the test asserts a value.

## Evidence

- Factory or fixture file and the scenario it represents.
- Data-safety check: no production data, secrets, or personal data.
- Cleanup assertion or isolated-resource note.
- Snapshot review when a snapshot changes.

## Exceptions

A shared fixture is allowed only when it is immutable, namespaced, and the suite proves it cannot leak state.
