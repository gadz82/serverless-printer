@completion
Feature: Template engine and placeholder schema
  Handlebars rendering is predictable in every mode, and the manifest describes the data a
  template expects.

  @req:R-101
  Scenario: Lenient mode renders missing fields as empty
    Given a template that references an optional customer name
    When it renders with a payload that omits the name
    Then the output contains an empty string for that field

  @req:R-101
  Scenario: Strict mode rejects any missing field
    Given the strict mode
    When a required field is absent from the payload
    Then rendering fails with TEMPLATE_RENDER_FAILED

  @req:R-101
  Scenario: Assume-objects mode only rejects a missing parent
    Given the assume-objects mode
    When a nested parent object is absent
    Then rendering fails
    But a missing leaf inside a present parent renders empty

  @req:R-101
  Scenario: Only fixed helpers are available
    Given a template that calls an unregistered helper
    When it renders
    Then compilation fails with TEMPLATE_RENDER_FAILED

  @req:R-102
  Scenario: The manifest records placeholder shapes
    Given a template with each, if, unless, with and dotted fields
    When the manifest is built
    Then each becomes an array, if/unless a boolean, with an object and dotted paths nested keys

  @req:R-105
  Scenario: Validation rejects invalid identity and compilation
    Given a template with a duplicate slug or a Handlebars syntax error
    When validation runs
    Then it fails with a clear message

  @req:R-105
  Scenario: Check blocks identity changes
    Given a template whose id or slug changed against the base commit
    When template:check runs
    Then it fails without changing the template
