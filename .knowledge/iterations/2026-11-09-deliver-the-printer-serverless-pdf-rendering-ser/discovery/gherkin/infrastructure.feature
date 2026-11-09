@foundation
Feature: Provisioned infrastructure
  The single deployment is created only by Terraform, with bootstrap applied once and the
  printer module providing the runtime resources.

  @req:R-005
  Scenario: Bootstrap creates the deployment foundation
    Given an administrator with AWS credentials
    When bootstrap is applied once
    Then the state bucket, artifacts bucket, OIDC provider and roles exist
    And the state backend uses native locking

  @req:R-005
  Scenario: The printer module creates the runtime resources
    Given bootstrap outputs and a release value
    When Terraform applies the deployment
    Then the jobs queue and DLQ, prints bucket and KMS key exist
    And the worker Lambda, live alias and event source mapping exist
    And alarms are disabled by default
