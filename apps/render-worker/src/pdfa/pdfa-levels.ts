import type { PdfaLevel } from "@printer/domain";

export type PdfaLevelProfile = {
  readonly part: "1" | "2" | "3";
  readonly conformance: "A" | "B" | "U";
  readonly pdfVersion: {
    readonly major: number;
    readonly minor: number;
  };
};

/**
 * PDF/A uses a fixed PDF version per part: part 1 is PDF 1.4, parts 2 and 3
 * are PDF 1.7. Object streams stay disabled so the part-1 output remains a
 * PDF 1.4 file.
 */
export const PDFA_LEVEL_PROFILES: Readonly<Record<PdfaLevel, PdfaLevelProfile>> = {
  "PDF/A-1b": { part: "1", conformance: "B", pdfVersion: { major: 1, minor: 4 } },
  "PDF/A-1a": { part: "1", conformance: "A", pdfVersion: { major: 1, minor: 4 } },
  "PDF/A-2b": { part: "2", conformance: "B", pdfVersion: { major: 1, minor: 7 } },
  "PDF/A-2u": { part: "2", conformance: "U", pdfVersion: { major: 1, minor: 7 } },
  "PDF/A-2a": { part: "2", conformance: "A", pdfVersion: { major: 1, minor: 7 } },
  "PDF/A-3b": { part: "3", conformance: "B", pdfVersion: { major: 1, minor: 7 } },
  "PDF/A-3u": { part: "3", conformance: "U", pdfVersion: { major: 1, minor: 7 } },
  "PDF/A-3a": { part: "3", conformance: "A", pdfVersion: { major: 1, minor: 7 } },
};
