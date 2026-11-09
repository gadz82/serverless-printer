import { describe, expect, it } from "vitest";

import type {
  PrintError,
  PrintFailureResult,
  PrintResult,
  PrintSuccessResult,
} from "../src/index.js";
import { formatValidationErrors, validateResult } from "../src/index.js";
import {
  failureResultFor,
  failureResultWithTemplate,
  failureResultWithoutTemplate,
  invalidResultFixtures,
  s3SuccessResult,
  smokeSuccessResult,
  sqsSuccessResult,
  validResultFixtures,
} from "./fixtures/result.fixtures.js";

const pdfaLevels = [
  "PDF/A-1b",
  "PDF/A-1a",
  "PDF/A-2b",
  "PDF/A-2u",
  "PDF/A-2a",
  "PDF/A-3b",
  "PDF/A-3u",
  "PDF/A-3a",
] as const;

const errorCodeTable: readonly { code: PrintError["code"]; retryable: boolean }[] = [
  { code: "INVALID_MESSAGE", retryable: false },
  { code: "PDFA_LEVEL_NOT_ALLOWED", retryable: false },
  { code: "TEMPLATE_NOT_FOUND", retryable: false },
  { code: "CALLBACK_NOT_ALLOWED", retryable: false },
  { code: "TEMPLATE_RENDER_FAILED", retryable: false },
  { code: "PDFA_CONVERSION_FAILED", retryable: false },
  { code: "PDF_RENDER_FAILED", retryable: true },
  { code: "DELIVERY_FAILED", retryable: true },
];

describe("result contract", () => {
  it("exposes valid generated success and failure types", () => {
    const sqsSuccess: PrintSuccessResult = sqsSuccessResult;
    const s3Success: PrintSuccessResult = s3SuccessResult;
    const smokeSuccess: PrintSuccessResult = smokeSuccessResult;
    const nullTemplateFailure: PrintFailureResult = failureResultWithoutTemplate;
    const templateFailure: PrintFailureResult = failureResultWithTemplate;
    const anyResult: PrintResult = sqsSuccess;

    expect(validateResult(sqsSuccess)).toBe(true);
    expect(validateResult(s3Success)).toBe(true);
    expect(validateResult(smokeSuccess)).toBe(true);
    expect(validateResult(nullTemplateFailure)).toBe(true);
    expect(validateResult(templateFailure)).toBe(true);
    expect(validateResult(anyResult)).toBe(true);
  });

  it.each(validResultFixtures)("accepts $name", ({ value }) => {
    expect(validateResult(value)).toBe(true);
    expect(validateResult.errors).toBeNull();
  });

  it.each(invalidResultFixtures)("rejects $name", ({ value, path, keyword }) => {
    expect(validateResult(value)).toBe(false);
    expect(validateResult.errors).not.toBeNull();
    expect(formatValidationErrors(validateResult.errors)).toContain(`${path} [${keyword}]`);
  });

  it.each(errorCodeTable)("accepts $code with retryable $retryable", ({ code, retryable }) => {
    expect(validateResult(failureResultFor(code, retryable))).toBe(true);
  });

  it.each(errorCodeTable)(
    "rejects $code with the opposite retryable flag",
    ({ code, retryable }) => {
      expect(validateResult(failureResultFor(code, !retryable))).toBe(false);
    },
  );

  it.each(pdfaLevels)("accepts success result pdfA %s", (pdfA) => {
    const result: PrintSuccessResult = {
      ...s3SuccessResult,
      pdfA,
    };

    expect(validateResult(result)).toBe(true);
  });

  it("accepts a success result with pdfA null", () => {
    expect(validateResult({ ...s3SuccessResult, pdfA: null })).toBe(true);
  });

  it("accepts a failure result with a null or non-null template", () => {
    expect(validateResult(failureResultWithoutTemplate)).toBe(true);
    expect(validateResult(failureResultWithTemplate)).toBe(true);

    expect(validateResult({ ...failureResultWithTemplate, template: null })).toBe(true);
    expect(validateResult({ ...failureResultWithoutTemplate, template: null })).toBe(true);
  });

  it("omits printing for the s3 channel and requires both printing fields otherwise", () => {
    expect(validateResult(s3SuccessResult)).toBe(true);
    expect(validateResult(sqsSuccessResult)).toBe(true);

    const withoutExpiry = structuredClone(sqsSuccessResult) as unknown as Record<string, unknown>;
    delete withoutExpiry["printingExpiresAt"];
    expect(validateResult(withoutExpiry)).toBe(false);

    const withoutPrinting = structuredClone(sqsSuccessResult) as unknown as Record<string, unknown>;
    delete withoutPrinting["printing"];
    expect(validateResult(withoutPrinting)).toBe(false);
  });

  it("rejects every non-string, non-number, non-object refId", () => {
    expect(validateResult({ ...sqsSuccessResult, refId: ["a"] })).toBe(false);
    expect(validateResult({ ...sqsSuccessResult, refId: true })).toBe(false);
    expect(validateResult({ ...sqsSuccessResult, refId: null })).toBe(false);
  });

  it("accepts the reserved _smoke template slug in a result", () => {
    expect(validateResult(smokeSuccessResult)).toBe(true);

    const upperCaseSlug = structuredClone(smokeSuccessResult) as unknown as {
      template: { slug: string };
    };
    upperCaseSlug.template.slug = "Smoke";
    expect(validateResult(upperCaseSlug)).toBe(false);
  });
});
