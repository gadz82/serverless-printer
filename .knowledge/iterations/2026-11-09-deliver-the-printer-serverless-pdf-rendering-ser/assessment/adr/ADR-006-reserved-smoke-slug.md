# ADR-006 — `_smoke` is a reserved internal slug

- Status: proposed
- Date: 2026-11-09
- Deciders: TECH_LEAD, PM, QE, human release owner
- Related: R-003, R-012, S-005, S-014

## Context

The specification names the post-deploy smoke template `_smoke` and says the smoke job uses it
"by slug" (§7.3). The same specification defines the public slug pattern as
`^[a-z][a-z0-9-]{2,63}$`, which forbids a leading underscore. The two statements cannot both be
true without an explicit exception. The discrepancy was found during planning; it does not
change product scope, but it must be resolved before the manifest and template validation are
implemented.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| Reserve `_smoke` as the only internal slug exception (chosen) | Low | Low | High | Keeps the specified smoke path working |
| Rename the folder and slug to `smoke` | Low | Medium | Medium | Contradicts the specification and every smoke reference |
| Resolve the smoke template by id only | Low | Medium | Medium | Contradicts the specified "by slug" smoke step |
| Loosen the regex for all leading underscores | Low | High | Low | Weakens the public identity rule for every template |

## Decision

`_smoke` is a reserved internal template slug, exempt from the public slug pattern. It is used
only by the post-deploy smoke path and is never a business template. Every other template slug
must match `^[a-z][a-z0-9-]{2,63}$`. The Phase 2 `template:validate` command special-cases
`_smoke` and rejects any other leading-underscore slug. The job contract accepts `_smoke` as a
`templateId`; resolution still goes through the manifest.

## Consequences

- The specified smoke path works by slug without weakening the public identity rule.
- One explicit exception exists and is documented in validation, the manifest and the runbook.
- A second reserved slug would require a new ADR; the exception must not become a pattern.

## Rejected options

- Renaming: breaks the specification and the documented smoke command.
- Id-only smoke: contradicts §7.3 and reduces the smoke test's coverage of slug resolution.
- Loosening the regex: permanently weakens template identity for a one-off internal case.

## Risk acceptance

The reserved exception is accepted because the specification explicitly requires the `_smoke`
smoke path and the public slug rule remains intact for all business templates.
