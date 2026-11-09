---
id: code-style
title: Automated code style and quality gates
summary: The project linter, formatter, type checker, static analysis, and comment contract are the source of truth.
kind: code_style
authority: blocking
phases: [discovery, assessment, build, code_review, logic_review]
tags: [style, lint, formatting, static-analysis, comments, memory, cross-language]
---
# Rule

Code style is enforced by tools, not by reviewers arguing about taste. The project must declare
its linter, formatter, type checker, and static-analysis commands in the repository or in
`execution.test_commands`. Changed code must pass those gates before it can be considered done.

The exact tool is project-specific and language-specific. Examples include ESLint, Prettier,
and `tsc` for TypeScript; `gofmt`, `go vet`, and `golangci-lint` for Go; Ruff, Black, and mypy
for Python; PHP-CS-Fixer and PHPStan for PHP; rustfmt and clippy for Rust; Spotless,
Checkstyle, and Error Prone for Java; RuboCop and Sorbet for Ruby; and SonarQube for any
language it supports. This rule governs the evidence, not the vendor or language.

# Why

Manual style debate hides real defects and slows review. A declared gate makes the baseline
reproducible, keeps diffs focused on behaviour, and prevents a green test suite from masking
broken typing or static analysis. The comment and memory rules keep durable history out of code
while preserving the one anchor that links a unit to its decision record.

# Comments and memory

The constitution defines the contract; this rule makes it blocking at the gate.

- An inline comment must not restate *what* the code already says. It explains why the code
  exists, why the choice is safe, or which non-obvious invariant it protects.
- A significant unit gets exactly one `ORCHID-MEM: <uuidv7> — <short behaviour description>`
  anchor and one linked UUID docblock. The docblock `History` names the relevant ADR,
  specification, requirement, or scenario.
- Never use comments for changelogs, dates, authors, prompt IDs, copied history, commented-out
  code, or review notes. Those belong in the docblock and manifest.
- Mint a UUID with `orchid-sdd new-uuid`, record the `CodeUnit`, write the docblock, and run
  `orchid-sdd lint`. Tests and private one-liners do not get anchors.

# Checks

- The repository declares at least one style or static-analysis gate for each active language.
- The gate runs on changed files, not only an unchanged baseline.
- New suppressions, disables, `nolint`, or `NOSONAR` markers have a reason and an owner.
- Formatting is automated; reviewers do not request manual whitespace changes.
- The change does not weaken an existing rule to make the build pass.
- A green test suite does not substitute for a failing style gate.
- Every generated comment explains why or an invariant, not what the code does.
- Significant units have one anchor with a non-empty description and a linked docblock.
- Inline comments contain no history log, and docblock `History` references resolve.

# Evidence

- Discovery: commands, baseline, existing comment debt, and violations that affect scope.
- Assessment: whether the change adds an anchor, docblock, suppression, or migration.
- Build: exact command, result, anchor, and docblock path in the prompt report.
- Code review: gate passed, comments minimal, and new suppressions justified.
- Logic review: docblock history and delivered behaviour still agree.

# Exceptions

Changing a lint rule is a reviewed change. It requires an ADR when it affects the whole
repository or weakens a blocking gate. A local suppression is not an exception; it is a finding
with a reason and an owner. Missing history is never an exception: record it in the docblock and
manifest before claiming the prompt is done.

# Example fit

The shipped examples show shape, not a memory template: `../examples/typescript/domain-service.ts`
has a concise why comment and a named contract, and `../examples/typescript/hexagonal-port.ts`
keeps the port small. They are illustrative units, not production code: do not copy their
missing anchor into a real unit. When a project language example exists, its formatting and
comment style are binding.
