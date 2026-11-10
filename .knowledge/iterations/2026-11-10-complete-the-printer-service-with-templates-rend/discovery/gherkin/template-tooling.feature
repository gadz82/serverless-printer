@completion
Feature: Template tooling and real template
  Template maintainers can create, validate, guard and preview templates with the same engine the
  worker uses.

  @req:R-103
  Scenario: template:new creates a valid template folder
    Given a new slug
    When pnpm template:new runs
    Then the folder and template.json exist with a fresh UUID v4
    And validation accepts the new template

  @req:R-103
  Scenario: Validation warns about an unbundled font without failing
    Given a CSS font-family that is neither bundled nor a default font
    When template:validate runs
    Then it prints a warning and exits successfully

  @req:R-103
  Scenario: Preview renders sample or supplied data
    Given the annual-statement template
    When template:preview runs with sample.json or --data
    Then a PDF is produced with the same use case as production
    And --pdfa and --strict are honoured

  @req:R-104
  Scenario: A real template renders by id and slug after deploy
    Given the annual-statement template is deployed
    When one job uses its UUID and another uses its slug
    Then both produce the same content and template metadata
    And a PDF/A request produces the requested level
