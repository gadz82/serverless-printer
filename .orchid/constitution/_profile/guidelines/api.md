# API guidelines

Intent: keep every external contract predictable, versioned, and safe for its consumers.

## Required

- Model resources as nouns. Use an explicit action segment only when the operation is not CRUD.
- Validate the request shape and authorisation before business logic or persistence.
- Return stable machine-readable error codes plus a human-readable message; never expose stack traces, SQL, or internal identifiers.
- Prefer additive changes. A breaking change needs a new version, a migration path, an ADR, and a consumer inventory.
- Paginate every collection; define the page size, ordering, and cursor or offset contract.
- Document authentication, authorisation, idempotency, and rate limits with the endpoint.
- Make retries safe: name the idempotency key or state why the operation cannot be retried.
- Update the contract tests and every known consumer when the shape changes.
- Deprecate before removal; record the removal date and the owner of each consumer.

## Anti-patterns

- Returning `200` with an error body, or a different error shape per endpoint.
- Leaking ORM rows, database IDs, or framework objects through the response.
- An unbounded list or a query parameter that disables pagination.
- Changing a required field or error code without a version.
- Documenting authentication only at the gateway while the resource checks nothing.
- Treating a generated client as proof that consumers were migrated.

## Evidence

- Contract test or schema diff for every changed request, response, or error code.
- Consumer inventory and version/migration note in the assessment artifact.
- Endpoint documentation for auth, idempotency, pagination, and limits.
- An ADR for every breaking change.

## Exceptions

A breaking change is not waived by urgency. It ships with a version, a migration window, and human approval recorded in the ADR.
