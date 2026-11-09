---
id: code-style-sonarqube
title: SonarQube quality-gate preset
summary: The project quality gate is blocking for new code and new violations.
kind: code_style
authority: blocking
phases: [assessment, build, code_review, logic_review]
tags: [sonarqube, quality-gate, coverage, static-analysis]
---
# Rule

The SonarQube quality gate is the source of truth for static analysis. New code must not add
blocking issues, security hotspots, or uncovered branches beyond the project threshold. The
quality gate must run on the integration result, not only on an implementer’s local branch.

# When to use

- The project already uses SonarQube as its quality gate.
- A single cross-language gate is preferred over separate tool verdicts.
- The change adds new code and the quality gate can run on the integration result.

# Conflicts

- Do not combine with a language preset whose severities or coverage thresholds contradict the
  quality gate. Pick one source of truth; the other may run only as an advisory signal.

# Adds to the defaults

- Default `code-style` requires a declared gate; this preset adds a gate result on new code,
  security-hotspot disposition, coverage/duplication thresholds, and `NOSONAR` ownership.

# Checks

- The quality-gate command or scanner is recorded and reproducible.
- New violations are zero for the project’s blocking severities.
- Coverage and duplication thresholds are evaluated for new code.
- `NOSONAR` and exclusions are reviewed and owned.
- Security hotspots have a disposition, not a silent dismissal.

# Evidence

Attach the quality-gate result, project key, branch/revision, and scan timestamp to the prompt
report and the logic-review checklist. A local scan is supporting evidence; the integration
result is the verdict.

# Example fit

No SonarQube-specific syntax exists. Use the language style exemplars as the code under the gate
and attach the gate result; a snippet cannot prove that a quality gate passed.
