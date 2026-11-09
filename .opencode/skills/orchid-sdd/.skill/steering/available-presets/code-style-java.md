---
id: code-style-java
title: Java style preset
summary: Spotless or Checkstyle, static analysis, and explicit nullability.
kind: code_style
authority: blocking
phases: [assessment, build, code_review, logic_review]
tags: [java, spotless, checkstyle, error-prone, nullability]
examples:
  - path: ../examples/java/StyleExample.java
    title: "Java style exemplar"
    language: java
---
# Rule

Java code must pass the project formatter (`Spotless`, `google-java-format`, or equivalent), its
Checkstyle/PMD rules, and the configured static analyzer (`Error Prone`, SpotBugs, Sonar, or
equivalent). Public boundaries should have explicit nullability or validation contracts.

# When to use

- Java is an active language in the changed code.
- The repository has no conflicting Java style gate.
- The change touches a public boundary that needs nullability or exception rules.

# Conflicts

- Do not enable a second Java style preset. SonarQube may run alongside only when its gate
  severities and thresholds do not contradict this one.

# Adds to the defaults

- Default `code-style` requires a declared gate; this preset adds formatter, Checkstyle/PMD,
  static analysis, and Java-specific nullability and exception checks.

# Checks

- Formatter and style checks pass.
- Static analysis and the build pass without new blocking findings.
- Public APIs document nullability, validation, and exceptions.
- Checked exceptions are used only where callers can act.
- Framework annotations stay out of domain types.
- New suppressions have a reason and an owner.
- Tests cover failure paths and boundary conditions.

# Evidence

Attach the exact formatter, analyzer, and test commands and results to the prompt report and
logic-review checklist. Name the analyzer version and the configured rule set.

# Example fit

`StyleExample.java` shows a record, explicit null and amount validation, constructor injection,
and a why-only comment; use it as the review shape, not a file to paste.
