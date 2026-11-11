@final
Feature: Output channel examples
  Callers can copy a valid job and the matching Terraform configuration for each output channel.

  @req:R-302
  Scenario: Every channel has a focused example
    Given the examples folder
    When a caller opens the index
    Then each documented output channel has at least one example
    And each example includes a valid job, a config snippet and a README

  @req:R-302
  Scenario: Examples stay valid
    Given the examples are committed
    When the test suite runs
    Then every job and ingress detail validates against @printer/contracts
    And there are between six and eight examples
