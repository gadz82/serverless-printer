@final
Feature: PDF/A post-processing
  A requested PDF/A level is produced by post-processing Chromium output, or the job fails
  explicitly.

  @req:R-202
  Scenario: Each enabled level is produced
    Given a standard PDF from Chromium
    When the requested level is one of the eight allowed levels
    Then the output declares the correct version and XMP part/conformance
    And the sRGB ICC output intent is embedded
    And the Info dictionary is consistent

  @req:R-202
  Scenario: Unsafe PDFs fail conversion
    Given a PDF with an unembedded font, encryption or JavaScript
    When PDF/A post-processing runs
    Then the job fails with PDFA_CONVERSION_FAILED
    And no PDF/A result is delivered
