---
id: code-style-typescript
title: TypeScript style preset
summary: Type-safe boundaries, no implicit any, and formatter/linter evidence.
kind: code_style
authority: blocking
phases: [assessment, build, code_review, logic_review]
tags: [typescript, eslint, prettier, types]
examples:
  - path: ../examples/typescript/style-example.ts
    title: "TypeScript style exemplar"
    language: typescript
---
# Rule

TypeScript code must pass the project’s formatter, linter, and type checker. Prefer explicit
domain types at public boundaries. Do not use `any` to bypass a design problem; use `unknown`
plus validation or a named type. Keep framework decorators and transport DTOs out of the domain.

# When to use

- TypeScript is an active language in the changed code.
- The repository has no conflicting TypeScript style gate.
- The change touches a public boundary, runtime input, or a type escape hatch.

# Conflicts

- Do not enable a second TypeScript style preset. SonarQube may run alongside only when its gate
  severities and thresholds do not contradict this one.

# Adds to the defaults

- Default `code-style` requires a declared gate; this preset adds `tsc`, formatter/linter
  evidence, and TypeScript-specific checks for `any`, non-null assertions, and runtime validation.

# Checks

- `tsc --noEmit` or the project equivalent passes.
- The configured formatter and linter pass on changed files.
- New `any`, non-null assertions, and suppressions have a reason and an owner.
- Public functions have explicit input/output types where inference is not obvious.
- Runtime validation exists at untrusted boundaries.

# Evidence

Attach the exact commands and results to the prompt report and the logic-review checklist.
Record the TypeScript version and the strictness settings.

# Example fit

`style-example.ts` shows explicit types, a named error class, runtime guards, and a why-only
comment; use it as the review shape, not a file to paste.
