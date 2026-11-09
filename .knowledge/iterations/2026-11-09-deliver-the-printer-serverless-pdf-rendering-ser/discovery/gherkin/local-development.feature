@foundation
Feature: Local development
  The same worker code runs as plain Node against LocalStack, without an AWS account.

  @req:R-007
  Scenario: A local job completes against LocalStack
    Given docker-compose is running LocalStack and the callback sink
    When a developer sends a valid job
    Then the worker stores the PDF in LocalStack S3
    And the callback sink records one success result

  @req:R-007
  Scenario: A local failure is visible in the callback sink
    Given a job with an unknown template
    When the developer runs the local worker
    Then the callback sink records a TEMPLATE_NOT_FOUND failure
