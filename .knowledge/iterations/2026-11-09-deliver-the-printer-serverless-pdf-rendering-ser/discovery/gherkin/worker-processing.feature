@foundation
Feature: Worker processing, failures and retention
  The worker turns one valid job into one stored print or one explicit failure, and transient
  prints disappear on schedule.

  @req:R-003
  Scenario: A valid job stores a PDF and returns success
    Given a valid job for the _smoke template
    When the worker processes the job
    Then a PDF object is stored under prints/<printId>.pdf
    And the result has success true, a sha256, a size and a printing link

  @req:R-003
  Scenario: An unknown template is a non-retryable failure
    Given a job whose templateId matches no bundled template
    When the worker processes the job
    Then the result has success false and error code TEMPLATE_NOT_FOUND
    And the job is not retried

  @req:R-008
  Scenario: A retryable failure is retried and then dead-lettered
    Given the worker fails with a retryable error on every attempt
    When the configured receive count is exhausted
    Then the message is sent to the DLQ

  @req:R-008
  Scenario: The last attempt sends a failure result
    Given the worker reaches its last allowed attempt
    When the failure callback is reachable
    Then a failure result with attempts and retryable is delivered
    And the job is deleted

  @req:R-009
  Scenario: Prints expire and links are short-lived
    Given a stored print
    When one day passes
    Then the object is removed by the bucket lifecycle rule
    And a presigned link expires after the configured TTL
