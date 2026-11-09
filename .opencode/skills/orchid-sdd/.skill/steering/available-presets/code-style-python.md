---
id: code-style-python
title: Python style preset
summary: Ruff or Black, a type checker, and explicit exception handling.
kind: code_style
authority: blocking
phases: [assessment, build, code_review, logic_review]
tags: [python, ruff, black, mypy, pyright, pytest]
examples:
  - path: ../examples/python/style_example.py
    title: "Python style exemplar"
    language: python
---
# Rule

Python code must pass the project formatter and linter (`ruff`, `black`, or the configured
equivalent) and its type checker (`mypy`, `pyright`, or equivalent). Prefer explicit exceptions
and typed boundaries over bare `except` blocks or untyped dictionaries.

# When to use

- Python is an active language in the changed code.
- The repository has no conflicting Python style gate.
- The change adds a public function, data boundary, or exception path.

# Conflicts

- Do not enable a second Python style preset. SonarQube may run alongside only when its gate
  severities and thresholds do not contradict this one.

# Adds to the defaults

- Default `code-style` requires a declared gate; this preset adds formatter/linter/type-checker
  commands and Python-specific checks for annotations and exception handling.

# Checks

- Formatter and linter pass on changed files.
- Type checking passes at the project’s configured strictness.
- Public functions and data boundaries have useful annotations.
- Expected failures raise specific exceptions; broad catches are justified.
- Dependencies and environment assumptions are declared.
- Tests cover failure paths, not only happy paths.
- New suppressions have a reason and an owner.

# Evidence

Attach the exact formatter, linter, and type-checker commands and results to the prompt report
and logic-review checklist. Record the Python version and the strictness level.

# Example fit

`style_example.py` shows annotations, a Protocol boundary, explicit validation, and a why-only
comment; use it as the review shape, not a file to paste.
