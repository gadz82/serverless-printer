# Error handling

Intent: make failure visible, typed, and actionable without leaking internals or hiding defects.

## Required

- Use a typed error with a stable code, a human-readable message, and the context needed to diagnose it.
- Separate expected failures (validation, not found, conflict, permission) from defects (invariant broken, dependency misconfigured).
- Do not use exceptions for normal control flow.
- Preserve the cause when adding context; do not replace an error with a generic one.
- Map internal errors to public errors at the boundary; never expose stack traces, SQL, or secrets.
- Handle or rethrow every error. An empty catch block is a defect unless the failure is explicitly ignorable and tested.
- Log once, at the boundary, with correlation and the outcome; do not log the same failure at every layer.
- Retry only transient, idempotent operations; bound attempts and record the final failure.
- Tests assert the error code, the public message shape, and the resulting state, not only that an exception occurred.

## Anti-patterns

- `catch (e) {}` or a fallback that returns empty data on failure.
- String matching on error messages to decide behaviour.
- Throwing a new error without the original cause.
- Returning a stack trace or database error to a client.
- Retrying a non-idempotent write.
- A test that only asserts "it throws".

## Evidence

- Error catalogue or code list for public boundaries.
- Boundary test for each expected failure and one defect path.
- Redacted log sample with correlation ID.
- Test command and result in the prompt report.

## Exceptions

Silent failure is never acceptable. If a failure is deliberately ignored, record the reason, the observable signal, and the owner in the code or assessment artifact.
