@feature <name>
Feature: <capability>
  As a <actor>
  I want <behaviour>
  So that <outcome>

  @req:R-001
  Scenario: <observable behaviour>
    Given <context>
    When <action>
    Then <observable result>

  @req:R-001 @error
  Scenario: <failure path>
    Given <context>
    When <invalid action>
    Then <typed error and recovery>
