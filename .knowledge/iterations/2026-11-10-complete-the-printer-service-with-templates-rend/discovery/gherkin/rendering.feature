@completion
Feature: Chromium rendering
  Chromium renders the real template with JavaScript disabled, no external network and the
  documented page settings.

  @req:R-107
  Scenario: A template renders with JavaScript disabled
    Given a template with a script tag and an external image
    When the worker renders it
    Then the script does not execute
    And the external request is blocked
    And a PDF is produced from the allowed bundled resources

  @req:R-107
  Scenario: Page settings and header/footer are applied
    Given a multi-page template
    When the worker renders it
    Then the PDF is A4 by default, honours CSS page size and prints backgrounds
    And the header/footer contain the page number and total pages
    And the output is tagged

  @req:R-111
  Scenario: Render regression catches a visual change
    Given the reference PDFs for plain and PDF/A output
    When a template changes its appearance
    Then the regression test fails with the page/text/appearance difference
