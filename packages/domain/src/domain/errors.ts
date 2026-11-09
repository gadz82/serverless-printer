export type ErrorCode =
  | "INVALID_MESSAGE"
  | "PDFA_LEVEL_NOT_ALLOWED"
  | "TEMPLATE_NOT_FOUND"
  | "CALLBACK_NOT_ALLOWED"
  | "TEMPLATE_RENDER_FAILED"
  | "PDFA_CONVERSION_FAILED"
  | "PDF_RENDER_FAILED"
  | "DELIVERY_FAILED";

/**
 * Base for failures that may be exposed to a caller.
 *
 * The fixed code and retryable flag are the domain's public error taxonomy;
 * adapters wrap provider errors in one of these before rethrowing.
 */
export abstract class PrintJobError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly retryable: boolean;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidMessage extends PrintJobError {
  override readonly code = "INVALID_MESSAGE" as const;
  override readonly retryable = false as const;
}

export class PdfaLevelNotAllowed extends PrintJobError {
  override readonly code = "PDFA_LEVEL_NOT_ALLOWED" as const;
  override readonly retryable = false as const;
}

export class TemplateNotFound extends PrintJobError {
  override readonly code = "TEMPLATE_NOT_FOUND" as const;
  override readonly retryable = false as const;
}

export class CallbackNotAllowed extends PrintJobError {
  override readonly code = "CALLBACK_NOT_ALLOWED" as const;
  override readonly retryable = false as const;
}

export class TemplateRenderFailed extends PrintJobError {
  override readonly code = "TEMPLATE_RENDER_FAILED" as const;
  override readonly retryable = false as const;
}

export class PdfaConversionFailed extends PrintJobError {
  override readonly code = "PDFA_CONVERSION_FAILED" as const;
  override readonly retryable = false as const;
}

export class PdfRenderFailed extends PrintJobError {
  override readonly code = "PDF_RENDER_FAILED" as const;
  override readonly retryable = true as const;
}

export class DeliveryFailed extends PrintJobError {
  override readonly code = "DELIVERY_FAILED" as const;
  override readonly retryable = true as const;
}

export function isPrintJobError(value: unknown): value is PrintJobError {
  return value instanceof PrintJobError;
}
