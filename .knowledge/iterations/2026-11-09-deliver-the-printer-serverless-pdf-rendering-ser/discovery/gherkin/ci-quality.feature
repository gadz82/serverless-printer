@foundation
Feature: Pull-request quality gates and commit governance
  A change reaches main only through a pull request that passes code, contract, template and
  Terraform checks, with Conventional Commits and a linear squash-merged history.

  @req:R-006
  Scenario: A valid pull request passes the quality gates
    Given a pull request with valid code, contracts and Terraform
    When CI runs
    Then lint, typecheck, unit, contract and LocalStack integration tests pass
    And commitlint accepts every commit and the pull request title
    And terraform fmt, validate, tflint and plan pass

  @req:R-006
  Scenario: A failing contract or Terraform check blocks the pull request
    Given a pull request with an invalid contract or a Terraform error
    When CI runs
    Then the required check fails
    And the pull request cannot merge

  @req:R-010
  Scenario: A non-conventional commit is rejected
    Given a commit message that does not follow Conventional Commits
    When commitlint runs locally or in CI
    Then the check fails with the offending message

  @req:R-010
  Scenario: Squash merge keeps main linear
    Given a pull request with several commits
    When it is squash-merged
    Then main receives one Conventional Commit
    And no merge commit is created
