---
id: code-style-ruby
title: Ruby style preset
summary: RuboCop, a type checker where adopted, and explicit failure handling.
kind: code_style
authority: blocking
phases: [assessment, build, code_review, logic_review]
tags: [ruby, rubocop, sorbet, steep, tests]
examples:
  - path: ../examples/ruby/style_example.rb
    title: "Ruby style exemplar"
    language: ruby
---
# Rule

Ruby code must pass the project’s RuboCop configuration and its test suite. Where the project
uses Sorbet or Steep, type checking must pass at the configured strictness. Prefer explicit
objects and methods over `method_missing`, global state, or broad rescue clauses.

# When to use

- Ruby is an active language in the changed code.
- The repository has no conflicting Ruby style gate.
- The change touches metaprogramming, a public object boundary, or an exception path.

# Conflicts

- Do not enable a second Ruby style preset. SonarQube may run alongside only when its gate
  severities and thresholds do not contradict this one.

# Adds to the defaults

- Default `code-style` requires a declared gate; this preset adds RuboCop, optional Sorbet/Steep,
  and Ruby-specific checks for metaprogramming, rescue clauses, and domain boundaries.

# Checks

- RuboCop passes on changed files.
- The type checker, where configured, passes.
- Tests cover failure paths and boundary conditions.
- Exceptions are specific and rescued only where handled.
- Metaprogramming has a clear owner and a test.
- New inline suppressions have a reason and an owner.
- Framework concerns stay outside domain objects.

# Evidence

Attach the exact RuboCop, type-checker, and test commands and results to the prompt report and
logic-review checklist. Record the Ruby version and the RuboCop configuration used.

# Example fit

`style_example.rb` shows a frozen string literal, keyword arguments, explicit `ArgumentError`s,
and a why-only comment; use it as the review shape, not a file to paste.
