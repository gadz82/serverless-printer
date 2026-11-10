@final
Feature: Production readiness and cloud verification
  The service is measured, observable, operable and proven in the real AWS account.

  @req:R-206
  Scenario: The load test meets the confirmed target
    Given the confirmed jobs/minute, document mix and latency target
    When the load test runs with and without PDF/A
    Then throughput and p95 latency meet the target
    And Power Tuning selects memory with recorded cost

  @req:R-207
  Scenario: Alarms and runbook cover failure
    Given alarms are enabled with an SNS topic
    When the DLQ grows or the worker errors
    Then an alarm is published
    And the runbook explains rollback, DLQ redrive, template removal and recovery

  @req:R-208
  Scenario: Plain and PDF/A smoke pass
    Given a completed release
    When the smoke jobs run once plain and once with PDF/A
    Then both succeed and carry the deployed release
    And the first real template is live

  @req:R-209
  Scenario: Bootstrap, OIDC and rollback are verified
    Given the remote and AWS account
    When bootstrap is applied and a release is deployed
    Then the release uses OIDC only
    And an earlier release can be dispatched and passes both smoke jobs
    And branch protection and the release-bot bypass are documented

  @req:R-211
  Scenario: Local Chrome restricts file requests
    Given a template that references a file outside its folder
    When preview renders it
    Then the request is blocked and the preview fails or omits it
