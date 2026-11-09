# Test strategy

Intent: prove the accepted behaviour with the cheapest reliable test and make every gap explicit.

## Required

- Use the cheapest test that can prove the behaviour: unit for logic, integration for a real boundary, e2e for a critical journey.
- Map every acceptance criterion to at least one test, or record why no automated test is possible.
- Write a failing regression test before fixing a bug; keep the failing-before evidence.
- Tests are deterministic: control time, randomness, network, concurrency, and shared state.
- Test names describe the behaviour and the condition, not the implementation.
- Run the suite in a clean environment; record the exact command, version, and result.
- Treat coverage as a signal, not a target. An uncovered critical path is a defect; a high percentage is not proof.
- Quarantine a flaky test only with an owner, a reason, and a removal date.

## Anti-patterns

- A test pyramid inverted by slow, brittle e2e coverage.
- Mocking the boundary the test claims to verify.
- Retrying a flaky test until it passes.
- Happy-path-only suites and snapshot theatre.
- Asserting implementation calls instead of observable outcomes.
- A coverage threshold used to close a missing acceptance criterion.

## Evidence

- Acceptance-to-test matrix with test IDs and commands.
- Failing-before/passing-after output for a fix.
- Residual-risk note for every omitted test.
- CI result from the integration target.

## Exceptions

An untested path is allowed only with a recorded rationale, a risk statement, and acceptance by the blocking owner or human. "Time" is not a rationale.
