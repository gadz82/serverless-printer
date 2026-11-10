@final
Feature: Production Chromium rendering
  Chromium renders the real templates on Lambda with JavaScript disabled, external requests
  blocked and the documented page settings.

  @req:R-201
  Scenario: A real template renders on Lambda
    Given the generic-report template and sample payload
    When the worker renders the job
    Then Chromium produces a valid PDF with the expected text
    And JavaScript does not execute and external requests are blocked

  @req:R-201
  Scenario: The browser is reused and recovered
    Given multiple jobs in one Lambda instance
    When the first job succeeds and a later browser crashes
    Then the worker reuses the browser for the next page and relaunches after the crash
    And every job still produces one PDF

  @req:R-201
  Scenario: Page settings and timeouts apply
    Given a multi-page template
    When the worker renders it
    Then A4/printBackground/preferCSSPageSize/tagged and page-number headers/footers apply
    And a render exceeding 60 seconds fails with PDF_RENDER_FAILED

  @req:R-205
  Scenario: Render regression catches a visual change
    Given the reference PDFs for plain and PDF/A output
    When a template changes its appearance
    Then CI fails with the page/text/appearance difference
