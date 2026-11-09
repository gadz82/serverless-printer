---
id: code-style-go
title: Go style preset
summary: gofmt, go vet, static analysis, and meaningful error handling.
kind: code_style
authority: blocking
phases: [assessment, build, code_review, logic_review]
tags: [go, gofmt, vet, staticcheck, golangci-lint]
examples:
  - path: ../examples/go/style_example.go
    title: "Go style exemplar"
    language: go
---
# Rule

Go code must be formatted with `gofmt`, pass `go vet`, and pass the project’s configured static
analysis (`staticcheck` or `golangci-lint`). Return errors with context; do not discard them or
panic for expected failures.

# When to use

- Go is an active language in the changed code.
- The repository has no conflicting Go style gate.
- The project wants a concrete command set rather than a generic style rule.

# Conflicts

- Do not enable a second Go style preset. SonarQube may run alongside only when its severities
  and thresholds do not contradict this gate; name the source of truth.

# Adds to the defaults

- Default `code-style` requires a declared gate; this preset adds `gofmt`, `go vet`, static
  analysis, and Go-specific checks for error context, goroutines, and interfaces.

# Checks

- `gofmt -l` is empty for changed files.
- `go vet ./...` and the configured linter pass.
- Errors are wrapped with actionable context and checked before use.
- Goroutines have an owner, cancellation path, and no unbounded production.
- Interfaces are small and defined where they are consumed.
- Unsafe code and `//nolint` have a reason and an owner.

# Evidence

Attach the exact commands, versions, and results to the prompt report and logic-review
checklist. Record the linter version because a tool upgrade can change the verdict.

# Example fit

`style_example.go` shows formatted Go, wrapped errors, a small interface, and a why-only
comment; use it as the review shape, not a file to paste.
