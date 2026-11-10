import type { PdfaLevel } from "../domain/print-options.js";

export type PdfArchiveOptions = {
  readonly level: PdfaLevel;
  readonly title?: string;
  readonly language?: string;
  readonly createdAt?: Date;
};

/**
 * Post-processes a rendered PDF into a requested PDF/A level.
 *
 * Conformance is best effort: the adapter applies the archival metadata and
 * rejects documents that cannot be made archival (encryption, JavaScript or
 * unembedded fonts) by throwing a non-retryable `PdfaConversionFailed`.
 */
export interface PdfArchiver {
  archive(pdfBytes: Uint8Array, options: PdfArchiveOptions): Promise<Uint8Array>;
}
