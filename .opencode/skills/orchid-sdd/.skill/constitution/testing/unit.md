# Unit tests

Intent: prove one piece of logic quickly, deterministically, and without infrastructure.

## Required

- One behaviour per test; use arrange, act, assert.
- No network, filesystem, database, or clock dependence without an explicit fake.
- Assert observable outcomes and error codes, not call sequences, unless the interaction is the contract.
- Cover the boundaries that apply: empty, one, many, invalid, unauthorised, timeout, partial failure.
- Keep fixtures local and readable; a test should show the data that matters.
- Avoid shared mutable state between tests; each test creates what it needs.
- Make the test fail for the intended reason before the change and pass after it.
- Keep unit tests fast enough to run on every edit; move real-boundary checks to integration tests.

## Anti-patterns

- A test that mirrors the implementation and would pass with the bug present.
- Asserting that a mock was called while the behaviour is wrong.
- Sleeping or polling to hide a race.
- A shared fixture mutated by test order.
- A test that cannot fail because the assertion is unreachable.
- Testing private helpers instead of the behaviour they support.

## Evidence

- Test file and name that state the behaviour.
- Failing-before run and passing-after run with the exact command.
- Boundary list covered by the test or the adjacent suite.

## Exceptions

When the interaction is the contract, assert the interaction explicitly and state why the outcome alone is insufficient.
