# ADR-102 — Chromium renderer uses puppeteer-core plus @sparticuz/chromium

- Status: proposed
- Date: 2026-11-10
- Deciders: ARCHITECT, DEV, DEVOPS, human release owner
- Related: R-107, R-111, S-115–S-117

## Context

The service must render HTML/Handlebars to PDF on Lambda Node 24/x86_64 without a custom image or
layer, with JavaScript disabled, request interception, browser reuse and the documented page
settings.

## Options

| Option | Cost | Risk | Reversibility | Business impact |
|---|---|---|---|---|
| `puppeteer-core` + `@sparticuz/chromium` (chosen) | Medium | Medium packaging | High | Matches the spec and CI x86_64 |
| Playwright + custom browser bundle | Medium | High | Medium | Different runtime and packaging |
| Custom Lambda image | High | Medium | Low | Conflicts with zip deploy decision |

## Decision

Use `puppeteer-core` pinned to the Chromium major shipped by `@sparticuz/chromium`. Bundle the
package in the worker zip (external in esbuild), launch once per instance, open a page per job,
relaunch after a crash, disable JavaScript, intercept requests to allow only bundled files/data
URIs, and set A4/printBackground/preferCSSPageSize/tagged with page-number header/footer. Local
preview uses an installed Chrome; CI uses `@sparticuz/chromium` on Ubuntu x86_64.

## Consequences

- One renderer code path serves preview and production.
- CI and Lambda must stay on x86_64 and keep the package versions aligned.
-The worker zip grows by roughly 65 MB; cold start and `/tmp` use must be measured.
- Render regression is mandatory to catch Chromium/version drift.

## Rejected options

- Playwright: extra runtime and browser packaging effort.
- Custom image: the spec requires zip artifacts and no image/layer.

## Risk acceptance

Packaging risk is accepted and mitigated by version pinning, render regression and load/cold-start
evidence.
