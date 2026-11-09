# Integration tests

Intent: prove that the real boundary works with the real contract, migration, or infrastructure.

## Required

- Exercise the real boundary: database, queue, HTTP contract, filesystem, or external adapter.
- Use ephemeral resources and clean up deterministically; do not depend on a shared environment.
- Test migrations against a realistic schema, including the rollback or recovery path.
- Assert contract shape, status, error mapping, and persisted state, not internal queries.
- Namespace data per test so the suite is parallel-safe.
- Control time, retries, and eventual consistency with explicit waits and bounded timeouts.
- Fail with enough context to reproduce locally: command, service version, seed, and request.
- Keep production data out of the suite; generate or anonymise fixtures.

## Anti-patterns

- Mocking the service that the test claims to integrate with.
- A shared database that leaks state between tests.
- A migration test that only checks the forward path.
- An unbounded retry or sleep instead of a readiness check.
- A failure message that says only "expected true, got false".
- A test that requires the author's machine to pass.

## Evidence

- Service/container configuration and version.
- Migration and rollback command and result.
- Contract assertion and one failure-path result.
- Reproducible command in the prompt report.

## Exceptions

If a real dependency cannot run in CI, use a contract fake only when a separate test covers the real boundary; record the gap and the owner.
