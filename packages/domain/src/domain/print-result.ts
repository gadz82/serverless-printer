import type { ErrorCode } from "./errors.js";
import type { PdfaLevel } from "./print-options.js";
import type { RefId } from "./ref-id.js";
import type { TemplateMetadata } from "./template-descriptor.js";

export type PrintError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly attempts: number;
};

export type PrintSuccessResult = {
  readonly success: true;
  readonly printId: string;
  readonly refId: RefId;
  /** Presigned GET URL; omitted when the PDF is delivered to the caller's S3 URL. */
  readonly printing?: string;
  readonly printingExpiresAt?: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly pdfA: PdfaLevel | null;
  readonly template: TemplateMetadata;
  readonly renderedAt: string;
};

export type PrintFailureResult = {
  readonly success: false;
  readonly printId: string;
  readonly refId: RefId;
  readonly template: TemplateMetadata | null;
  readonly error: PrintError;
  readonly failedAt: string;
};

export type PrintResult = PrintSuccessResult | PrintFailureResult;
