# Coding guidelines

Intent: make the next change readable, testable, and reversible by the next engineer or agent.

## Required

- Give each function or class one responsibility; names state the behaviour, not the mechanism.
- Keep modules cohesive. Split a module before it becomes a collection of unrelated helpers.
- Avoid boolean flag parameters that change behaviour; pass a named options object or separate functions.
- Keep public surfaces narrow; make everything else private by default.
- Delete dead code; do not comment it out or leave feature graveyards.
- Use the standard library before adding a dependency. A dependency needs an ADR and an owner.
- Propagate errors explicitly; do not hide failure behind a default value or an empty collection.
- Keep dependency direction inward; domain code does not import transport, persistence, framework, or UI code.
- Add or update tests with the behaviour change; a refactor keeps tests green and does not add scope.
- Leave the change smaller than the prompt's write scope, not larger.

## Anti-patterns

- A utility module that imports every layer and becomes a hidden service locator.
- A flag such as `process(data, true)` whose meaning is invisible at the call site.
- A drive-by refactor that makes the diff harder to review.
- An abstraction introduced for a hypothetical consumer.
- A catch-all fallback that turns a defect into silent data loss.

## Evidence

- The diff stays inside `scope.write` and contains no unrelated edits.
- The test command and result are in the prompt report.
- The linter, formatter, and type checker pass on changed files.
- Significant units have an anchor and docblock when their behaviour changed.

## Exceptions

A deviation is recorded in the prompt report with the reason and owner. A deviation from a blocking rule, or one that changes a public contract, needs an ADR approved by the human owner.
