# Logging and telemetry

Intent: answer who did what, with which outcome, and where it failed, without leaking data or flooding the system.

## Required

- Emit structured events with stable field names: event, correlation ID, actor, resource, outcome, duration.
- Log at the boundary: request or job start, outcome, and failure with cause. Do not repeat the same event in every layer.
- Use levels consistently: error for failed operations needing attention, warn for degraded but handled, info for state changes, debug for diagnosis.
- Never log secrets, tokens, passwords, full card numbers, or personal data. Redact at the logger, not at each call site.
- Keep high-cardinality identifiers in traces, not metric labels.
- Sample high-volume events; keep errors and security events unsampled unless a written policy says otherwise.
- Include the correlation ID in every service that participates in the request.
- Define retention and access for logs; deletion follows the same policy as the underlying data.

## Anti-patterns

- Prose logs that require a parser to answer a basic question.
- String concatenation instead of structured fields.
- Logging the full request or response body.
- A debug log inside a tight loop.
- Logging the same exception at every layer.
- Personal data in an error message or URL.

## Evidence

- Log schema or field list for the changed path.
- Redaction test using a known fake secret, never a real one.
- One sample event for success and one for failure, with correlation.
- Retention/access note when the event contains user data.

## Exceptions

No exception permits logging a secret or personal data. If an investigation needs sensitive data, use a controlled, audited channel outside application logs.
