---
id: code-style-rust
title: Rust style preset
summary: rustfmt, clippy, tests, and justified unsafe code.
kind: code_style
authority: blocking
phases: [assessment, build, code_review, logic_review]
tags: [rust, rustfmt, clippy, cargo, unsafe]
examples:
  - path: ../examples/rust/style_example.rs
    title: "Rust style exemplar"
    language: rust
---
# Rule

Rust code must be formatted with `rustfmt`, pass `cargo clippy` at the project’s configured
level, and pass `cargo test`. Prefer explicit error types and `?` propagation over panics for
expected failure. `unsafe` requires a safety comment and an owner.

# When to use

- Rust is an active language in the changed code.
- The repository has no conflicting Rust style gate.
- The change introduces or changes an `unsafe` block, a public API, or an error type.

# Conflicts

- Do not enable a second Rust style preset. SonarQube may run alongside only when its gate
  severities and thresholds do not contradict this one.

# Adds to the defaults

- Default `code-style` requires a declared gate; this preset adds `rustfmt`, `clippy`, `cargo
  test`, and Rust-specific checks for error types, lifetimes, and unsafe justification.

# Checks

- `cargo fmt --check` passes.
- `cargo clippy` passes with the configured deny/warn policy.
- `cargo test` passes, including failure paths.
- Error enums or types are meaningful and preserve source context.
- `unsafe` blocks document the invariant they require and why they are sound.
- Public APIs have clear ownership and lifetime contracts.
- New `allow` attributes have a reason and an owner.

# Evidence

Attach the exact toolchain, commands, and results to the prompt report and logic-review
checklist. Record the Rust edition and the clippy configuration.

# Example fit

`style_example.rs` shows a typed error enum, `Result`, a trait boundary, and a why-only comment;
use it as the review shape, not a file to paste.
