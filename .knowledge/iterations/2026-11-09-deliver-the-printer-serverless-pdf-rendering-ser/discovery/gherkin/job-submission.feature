@foundation
Feature: Job submission and result contract
  The jobs queue is the only entry point. One job produces exactly one result, and the public
  contract is the JSON Schema shared with callers.

  @req:R-001
  Scenario: One valid job yields exactly one success result
    Given a valid job with a template id, a payload and an SQS success callback
    When the caller sends the job to the jobs queue
    Then the worker produces exactly one success result
    And the result contains the deterministic print id and the echoed refId

  @req:R-001
  Scenario: refId is echoed unchanged
    Given a job whose refId is a JSON object
    When the job completes
    Then the result refId equals the submitted object

  @req:R-002
  Scenario: The contract accepts a valid job
    Given a job fixture that satisfies the published job schema
    When the contract test validates it
    Then validation succeeds
    And the generated TypeScript type compiles

  @req:R-002
  Scenario: The contract rejects an invalid job
    Given a job fixture missing its templateId
    When the contract test validates it
    Then validation fails
    And no worker processing is attempted
