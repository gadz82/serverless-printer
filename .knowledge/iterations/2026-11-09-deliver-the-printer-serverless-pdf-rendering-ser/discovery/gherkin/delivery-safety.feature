@foundation
Feature: Delivery safety
  Only allowed senders may enqueue jobs, and the worker may deliver only to allowed callback
  targets.

  @req:R-011
  Scenario: Only allowed senders can enqueue jobs
    Given a sender identity outside the allowed accounts, principals and organization
    When it attempts to send a message to the jobs queue
    Then the queue policy denies the request

  @req:R-011
  Scenario: The worker cannot deliver to an unlisted target
    Given a result callback ARN outside the configured callback target ARNs
    When the worker attempts delivery
    Then the delivery is denied
    And the job follows the failure path
