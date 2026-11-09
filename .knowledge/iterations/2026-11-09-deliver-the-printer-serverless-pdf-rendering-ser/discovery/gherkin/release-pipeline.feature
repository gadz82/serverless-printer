@foundation
Feature: Release, smoke test and rollback
  Every push to main produces a deployable release value, deploys through OIDC, and is verified
  by the same job path callers use.

  @req:R-004
  Scenario: A release commit deploys through OIDC
    Given a Conventional Commit that warrants a release on main
    When the release workflow runs
    Then semantic-release tags vX.Y.Z and creates a GitHub Release
    And the deploy role is assumed through GitHub OIDC
    And Terraform applies with release vX.Y.Z
    And no static AWS credentials are used

  @req:R-004
  Scenario: A non-release commit deploys a sha release
    Given a docs-only commit on main
    When the release workflow runs
    Then no new SemVer tag is created
    And Terraform applies with release sha-<short sha>

  @req:R-012
  Scenario: The post-deploy smoke test passes
    Given a completed deploy
    When the smoke job is sent for the _smoke template through an SQS callback
    Then a success result arrives within 60 seconds
    And the workflow succeeds

  @req:R-012
  Scenario: Rollback deploys an earlier release
    Given an earlier release folder exists in the artifacts bucket
    When the release workflow is dispatched with that release
    Then versioning and build are skipped
    And Terraform applies that release
    And the smoke test passes
