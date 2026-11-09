# End-to-end tests

Intent: prove the critical user journeys through the delivered system, not every screen.

## Required

- Cover the journeys that must work for the product to be usable; keep the suite small and fast.
- Use stable selectors tied to accessible roles or explicit test IDs; never couple to DOM structure or CSS classes.
- Control external services with deterministic fakes or a recorded contract.
- Assert the outcome the user sees and the state that must persist, not implementation details.
- Name the scenario, the step, and the evidence in every failure.
- Capture a trace, screenshot, or video on failure; link it from the report.
- Quarantine a flaky test immediately with an owner, a reason, and a removal date.
- Run against the integration target, not only a local branch.

## Anti-patterns

- Using e2e for logic that a unit or integration test can prove.
- A selector based on layout or generated class names.
- Retrying a flaky test until it passes.
- A test that stops at the happy path and never reaches recovery.
- A failure that says only "timeout".
- A suite that takes so long that reviewers skip it.

## Evidence

- Journey-to-scenario map with the critical path.
- Command, environment, and result for the integration target.
- Failure artifact for a failing run.
- Quarantine record for every skipped or flaky test.

## Exceptions

Skipping a critical journey needs a recorded rationale, a compensating check, and acceptance by QE or the human owner.
