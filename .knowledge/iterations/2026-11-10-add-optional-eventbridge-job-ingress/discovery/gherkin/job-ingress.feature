@final
Feature: Optional EventBridge job ingress
  An operator can route matching EventBridge events into the existing jobs queue without changing
  the job contract or the default deployment.

  @req:R-301
  Scenario: Ingress is disabled by default
    Given job_rule is null
    When Terraform plans the stack
    Then no EventBridge rule or target is created
    And the jobs queue policy has no EventBridge statement

  @req:R-301
  Scenario: A configured rule forwards events to the jobs queue
    Given job_rule names an event bus and a valid event pattern
    When Terraform applies the stack
    Then an EventBridge rule exists on that bus
    And its target is the jobs queue
    And the queue policy allows events.amazonaws.com only from that rule ARN

  @req:R-301
  Scenario: Invalid ingress input fails early
    Given job_rule has an empty bus name or malformed event-pattern JSON
    When Terraform validates the variables
    Then the plan fails with an actionable validation message

  @req:R-301
  Scenario: Forwarded events use the normal job path
    Given EventBridge forwards a print-job payload to the jobs queue
    When the worker consumes it
    Then it follows the same schema validation, DLQ, callback and rendering rules as a direct SQS job
