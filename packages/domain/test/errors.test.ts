import { describe, expect, it } from "vitest";

import {
  CallbackNotAllowed,
  DeliveryFailed,
  InvalidMessage,
  PdfaConversionFailed,
  PdfaLevelNotAllowed,
  PdfRenderFailed,
  PrintJobError,
  TemplateNotFound,
  TemplateRenderFailed,
  isPrintJobError,
} from "../src/index.js";
import type { ErrorCode } from "../src/index.js";

type ErrorCase = {
  readonly name: string;
  readonly error: PrintJobError;
  readonly code: ErrorCode;
  readonly retryable: boolean;
};

const cases: readonly ErrorCase[] = [
  {
    name: "InvalidMessage",
    error: new InvalidMessage("invalid message"),
    code: "INVALID_MESSAGE",
    retryable: false,
  },
  {
    name: "PdfaLevelNotAllowed",
    error: new PdfaLevelNotAllowed("PDF/A level not allowed"),
    code: "PDFA_LEVEL_NOT_ALLOWED",
    retryable: false,
  },
  {
    name: "TemplateNotFound",
    error: new TemplateNotFound("template not found"),
    code: "TEMPLATE_NOT_FOUND",
    retryable: false,
  },
  {
    name: "CallbackNotAllowed",
    error: new CallbackNotAllowed("callback not allowed"),
    code: "CALLBACK_NOT_ALLOWED",
    retryable: false,
  },
  {
    name: "TemplateRenderFailed",
    error: new TemplateRenderFailed("template render failed"),
    code: "TEMPLATE_RENDER_FAILED",
    retryable: false,
  },
  {
    name: "PdfaConversionFailed",
    error: new PdfaConversionFailed("PDF/A conversion failed"),
    code: "PDFA_CONVERSION_FAILED",
    retryable: false,
  },
  {
    name: "PdfRenderFailed",
    error: new PdfRenderFailed("PDF render failed"),
    code: "PDF_RENDER_FAILED",
    retryable: true,
  },
  {
    name: "DeliveryFailed",
    error: new DeliveryFailed("delivery failed"),
    code: "DELIVERY_FAILED",
    retryable: true,
  },
];

describe("domain errors", () => {
  it.each(cases)(
    "$name carries its spec code and retryable flag",
    ({ name, error, code, retryable }) => {
      expect(error).toBeInstanceOf(PrintJobError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(name);
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(retryable);
      expect(isPrintJobError(error)).toBe(true);
    },
  );

  it("distinguishes a domain error from an unrelated error", () => {
    expect(isPrintJobError(new Error("plain"))).toBe(false);
    expect(isPrintJobError("not an error")).toBe(false);
    expect(isPrintJobError(null)).toBe(false);
  });

  it("preserves the original cause when an adapter error is wrapped", () => {
    const cause = new Error("socket closed");
    const error = new DeliveryFailed("delivery failed", { cause });

    expect(error.cause).toBe(cause);
  });
});
