---
id: code-style-php
title: PHP style preset
summary: PSR-12, PHP-CS-Fixer, and static analysis at an explicit level.
kind: code_style
authority: blocking
phases: [assessment, build, code_review, logic_review]
tags: [php, psr-12, php-cs-fixer, phpstan, psalm]
examples:
  - path: ../examples/php/StyleExample.php
    title: "PHP style exemplar"
    language: php
---
# Rule

PHP code must follow PSR-12 or the project’s declared standard, pass the formatter
(`php-cs-fixer` or equivalent), and pass the configured static analyzer (`PHPStan`, `Psalm`, or
equivalent). Use `declare(strict_types=1)` in new application code unless a documented
compatibility boundary requires otherwise.

# When to use

- PHP is an active language in the changed code.
- The repository has no conflicting PHP style gate.
- The change adds public methods or a boundary that needs parameter and return types.

# Conflicts

- Do not enable a second PHP style preset. SonarQube may run alongside only when its gate
  severities and thresholds do not contradict this one.

# Adds to the defaults

- Default `code-style` requires a declared gate; this preset adds PSR-12, the formatter, the
  analyzer level, and PHP-specific strict-types and exception checks.

# Checks

- Formatter and coding-standard checks pass.
- Static analysis passes at the project’s configured level.
- New public methods and boundaries have parameter and return types.
- Exceptions are specific and caught only where handled.
- Framework magic is isolated from domain code.
- `phpstan-ignore` or equivalent suppressions have a reason and an owner.

# Evidence

Attach the exact commands, analyzer level, and results to the prompt report and logic-review
checklist. Record the baseline level when the project raises it during the change.

# Example fit

`StyleExample.php` shows strict types, readonly constructor properties, typed errors, and a
why-only comment; use it as the review shape, not a file to paste.
