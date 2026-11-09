import type {
  PrintError,
  PrintFailureResult,
  PrintResult,
  ResultTemplate,
} from "../../src/index.js";

const PRINT_ID = "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c";
const TEMPLATE_ID = "6f1c2b0e-8a4d-4f7e-9c1a-2d3b4e5f6a7b";
const TEMPLATE_HASH = "a".repeat(64);
const PDF_HASH = "b".repeat(64);

const PRESIGNED_GET =
  "https://printer-prints.s3.eu-central-1.amazonaws.com/prints/3f0c8b7a.pdf" +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
  "&X-Amz-Credential=AKIAEXAMPLE%2F20261109%2Feu-central-1%2Fs3%2Faws4_request" +
  "&X-Amz-Date=20261109T100000Z" +
  "&X-Amz-Expires=900" +
  "&X-Amz-SignedHeaders=host" +
  "&X-Amz-Signature=0123456789abcdef";

export const template = {
  id: TEMPLATE_ID,
  slug: "annual-statement",
  contentHash: TEMPLATE_HASH,
  release: "v1.4.0",
} satisfies ResultTemplate;

export const sqsSuccessResult = {
  success: true,
  printId: PRINT_ID,
  refId: {
    invoice: "INV-2026-0001",
    lines: [1, 2, 3],
  },
  printing: PRESIGNED_GET,
  printingExpiresAt: "2026-11-09T10:15:00Z",
  sha256: PDF_HASH,
  sizeBytes: 48211,
  pdfA: null,
  template,
  renderedAt: "2026-11-09T10:00:00Z",
} satisfies PrintResult;

export const s3SuccessResult = {
  success: true,
  printId: PRINT_ID,
  refId: "invoice-2026-0002",
  sha256: PDF_HASH,
  sizeBytes: 1,
  pdfA: "PDF/A-2b",
  template,
  renderedAt: "2026-11-09T10:00:00.123Z",
} satisfies PrintResult;

export const smokeSuccessResult = {
  success: true,
  printId: PRINT_ID,
  refId: 17,
  printing: PRESIGNED_GET,
  printingExpiresAt: "2026-11-09T10:15:00+00:00",
  sha256: PDF_HASH,
  sizeBytes: 2048,
  pdfA: "PDF/A-3a",
  template: {
    id: TEMPLATE_ID,
    slug: "_smoke",
    contentHash: TEMPLATE_HASH,
    release: "sha-abc1234",
  },
  renderedAt: "2026-11-09T10:00:00Z",
} satisfies PrintResult;

export const failureResultWithoutTemplate = {
  success: false,
  printId: PRINT_ID,
  refId: "invoice-2026-0003",
  template: null,
  error: {
    code: "TEMPLATE_NOT_FOUND",
    message: "no template with that id or slug is in the deployed bundle",
    retryable: false,
    attempts: 1,
  },
  failedAt: "2026-11-09T10:00:05Z",
} satisfies PrintResult;

export const failureResultWithTemplate = {
  success: false,
  printId: PRINT_ID,
  refId: {
    invoice: "INV-2026-0004",
  },
  template,
  error: {
    code: "PDF_RENDER_FAILED",
    message: "renderer failed",
    retryable: true,
    attempts: 5,
  },
  failedAt: "2026-11-09T10:00:05Z",
} satisfies PrintResult;

export const validResultFixtures = [
  { name: "sqs success with printing and a null pdfA", value: sqsSuccessResult },
  { name: "s3 success without printing", value: s3SuccessResult },
  { name: "smoke success with the reserved _smoke slug", value: smokeSuccessResult },
  { name: "failure with a null template", value: failureResultWithoutTemplate },
  { name: "failure with template metadata", value: failureResultWithTemplate },
] as const;

export function failureResultFor(code: PrintError["code"], retryable: boolean): PrintFailureResult {
  return {
    success: false,
    printId: PRINT_ID,
    refId: "invoice-error-code",
    template: null,
    error: {
      code,
      message: `failure with ${code}`,
      retryable,
      attempts: 1,
    },
    failedAt: "2026-11-09T10:00:05Z",
  };
}

export type InvalidFixture = {
  readonly name: string;
  readonly value: unknown;
  readonly path: string;
  readonly keyword: string;
};

type UnknownRecord = Record<string, unknown>;

function successWith(change: (result: UnknownRecord) => void): unknown {
  const result = structuredClone(sqsSuccessResult) as unknown as UnknownRecord;
  change(result);
  return result;
}

function failureWith(change: (result: UnknownRecord) => void): unknown {
  const result = structuredClone(failureResultWithTemplate) as unknown as UnknownRecord;
  change(result);
  return result;
}

function templateOf(result: UnknownRecord): UnknownRecord {
  return result["template"] as UnknownRecord;
}

function errorOf(result: UnknownRecord): UnknownRecord {
  return result["error"] as UnknownRecord;
}

export const invalidResultFixtures: readonly InvalidFixture[] = [
  {
    name: "missing success",
    value: successWith((result) => {
      delete result["success"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "non-boolean success",
    value: successWith((result) => {
      result["success"] = "true";
    }),
    path: "/success",
    keyword: "type",
  },
  {
    name: "missing printId",
    value: successWith((result) => {
      delete result["printId"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "printId is not a uuid",
    value: successWith((result) => {
      result["printId"] = "not-a-uuid";
    }),
    path: "/printId",
    keyword: "pattern",
  },
  {
    name: "missing refId",
    value: successWith((result) => {
      delete result["refId"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "refId array",
    value: successWith((result) => {
      result["refId"] = [1, 2, 3];
    }),
    path: "/refId",
    keyword: "oneOf",
  },
  {
    name: "refId boolean",
    value: successWith((result) => {
      result["refId"] = false;
    }),
    path: "/refId",
    keyword: "oneOf",
  },
  {
    name: "refId null",
    value: successWith((result) => {
      result["refId"] = null;
    }),
    path: "/refId",
    keyword: "oneOf",
  },
  {
    name: "missing sha256",
    value: successWith((result) => {
      delete result["sha256"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "sha256 is too short",
    value: successWith((result) => {
      result["sha256"] = "a".repeat(63);
    }),
    path: "/sha256",
    keyword: "pattern",
  },
  {
    name: "sha256 is too long",
    value: successWith((result) => {
      result["sha256"] = "a".repeat(65);
    }),
    path: "/sha256",
    keyword: "pattern",
  },
  {
    name: "sha256 is uppercase",
    value: successWith((result) => {
      result["sha256"] = "A".repeat(64);
    }),
    path: "/sha256",
    keyword: "pattern",
  },
  {
    name: "sha256 is not hexadecimal",
    value: successWith((result) => {
      result["sha256"] = "z".repeat(64);
    }),
    path: "/sha256",
    keyword: "pattern",
  },
  {
    name: "missing sizeBytes",
    value: successWith((result) => {
      delete result["sizeBytes"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "zero sizeBytes",
    value: successWith((result) => {
      result["sizeBytes"] = 0;
    }),
    path: "/sizeBytes",
    keyword: "minimum",
  },
  {
    name: "negative sizeBytes",
    value: successWith((result) => {
      result["sizeBytes"] = -1;
    }),
    path: "/sizeBytes",
    keyword: "minimum",
  },
  {
    name: "fractional sizeBytes",
    value: successWith((result) => {
      result["sizeBytes"] = 1.5;
    }),
    path: "/sizeBytes",
    keyword: "type",
  },
  {
    name: "sizeBytes is a string",
    value: successWith((result) => {
      result["sizeBytes"] = "48211";
    }),
    path: "/sizeBytes",
    keyword: "type",
  },
  {
    name: "missing pdfA",
    value: successWith((result) => {
      delete result["pdfA"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "unknown pdfA level",
    value: successWith((result) => {
      result["pdfA"] = "PDF/A-4b";
    }),
    path: "/pdfA",
    keyword: "enum",
  },
  {
    name: "missing template",
    value: successWith((result) => {
      delete result["template"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "missing renderedAt",
    value: successWith((result) => {
      delete result["renderedAt"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "renderedAt is not RFC 3339",
    value: successWith((result) => {
      result["renderedAt"] = "09/11/2026 10:00";
    }),
    path: "/renderedAt",
    keyword: "pattern",
  },
  {
    name: "renderedAt has an impossible month",
    value: successWith((result) => {
      result["renderedAt"] = "2026-13-09T10:00:00Z";
    }),
    path: "/renderedAt",
    keyword: "pattern",
  },
  {
    name: "printing without printingExpiresAt",
    value: successWith((result) => {
      delete result["printingExpiresAt"];
    }),
    path: "/",
    keyword: "dependentRequired",
  },
  {
    name: "printingExpiresAt without printing",
    value: successWith((result) => {
      delete result["printing"];
    }),
    path: "/",
    keyword: "dependentRequired",
  },
  {
    name: "printing is not HTTPS",
    value: successWith((result) => {
      result["printing"] = PRESIGNED_GET.replace("https://", "http://");
    }),
    path: "/printing",
    keyword: "pattern",
  },
  {
    name: "printing is not presigned",
    value: successWith((result) => {
      result["printing"] = "https://printer-prints.s3.eu-central-1.amazonaws.com/prints/job.pdf";
    }),
    path: "/printing",
    keyword: "pattern",
  },
  {
    name: "printingExpiresAt is not RFC 3339",
    value: successWith((result) => {
      result["printingExpiresAt"] = "tomorrow";
    }),
    path: "/printingExpiresAt",
    keyword: "pattern",
  },
  {
    name: "printingExpiresAt has an impossible hour",
    value: successWith((result) => {
      result["printingExpiresAt"] = "2026-11-09T25:00:00Z";
    }),
    path: "/printingExpiresAt",
    keyword: "pattern",
  },
  {
    name: "template is not an object or null",
    value: successWith((result) => {
      result["template"] = "annual-statement";
    }),
    path: "/template",
    keyword: "anyOf",
  },
  {
    name: "template id is not a uuid",
    value: successWith((result) => {
      templateOf(result)["id"] = "annual-statement";
    }),
    path: "/template/id",
    keyword: "pattern",
  },
  {
    name: "template slug is invalid",
    value: successWith((result) => {
      templateOf(result)["slug"] = "Annual Statement";
    }),
    path: "/template/slug",
    keyword: "pattern",
  },
  {
    name: "template contentHash is invalid",
    value: successWith((result) => {
      templateOf(result)["contentHash"] = "short";
    }),
    path: "/template/contentHash",
    keyword: "pattern",
  },
  {
    name: "empty template release",
    value: successWith((result) => {
      templateOf(result)["release"] = "";
    }),
    path: "/template/release",
    keyword: "minLength",
  },
  {
    name: "missing template id",
    value: successWith((result) => {
      delete templateOf(result)["id"];
    }),
    path: "/template",
    keyword: "required",
  },
  {
    name: "missing template slug",
    value: successWith((result) => {
      delete templateOf(result)["slug"];
    }),
    path: "/template",
    keyword: "required",
  },
  {
    name: "missing template contentHash",
    value: successWith((result) => {
      delete templateOf(result)["contentHash"];
    }),
    path: "/template",
    keyword: "required",
  },
  {
    name: "missing template release",
    value: successWith((result) => {
      delete templateOf(result)["release"];
    }),
    path: "/template",
    keyword: "required",
  },
  {
    name: "unknown top-level field",
    value: successWith((result) => {
      result["pdfa"] = "PDF/A-2b";
    }),
    path: "/",
    keyword: "additionalProperties",
  },
  {
    name: "unknown template field",
    value: successWith((result) => {
      templateOf(result)["name"] = "Annual statement";
    }),
    path: "/template",
    keyword: "additionalProperties",
  },
  {
    name: "unknown error field",
    value: failureWith((result) => {
      errorOf(result)["detail"] = "stack trace";
    }),
    path: "/error",
    keyword: "additionalProperties",
  },
  {
    name: "failure missing success",
    value: failureWith((result) => {
      delete result["success"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "failure missing printId",
    value: failureWith((result) => {
      delete result["printId"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "failure missing refId",
    value: failureWith((result) => {
      delete result["refId"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "failure missing template",
    value: failureWith((result) => {
      delete result["template"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "failure missing error",
    value: failureWith((result) => {
      delete result["error"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "error is not an object",
    value: failureWith((result) => {
      result["error"] = "boom";
    }),
    path: "/error",
    keyword: "type",
  },
  {
    name: "failure missing failedAt",
    value: failureWith((result) => {
      delete result["failedAt"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "failedAt is not RFC 3339",
    value: failureWith((result) => {
      result["failedAt"] = "yesterday";
    }),
    path: "/failedAt",
    keyword: "pattern",
  },
  {
    name: "failedAt has an impossible day",
    value: failureWith((result) => {
      result["failedAt"] = "2026-11-32T10:00:00Z";
    }),
    path: "/failedAt",
    keyword: "pattern",
  },
  {
    name: "unknown error code",
    value: failureWith((result) => {
      errorOf(result)["code"] = "SOMETHING_FAILED";
    }),
    path: "/error/code",
    keyword: "enum",
  },
  {
    name: "missing error code",
    value: failureWith((result) => {
      delete errorOf(result)["code"];
    }),
    path: "/error",
    keyword: "required",
  },
  {
    name: "missing error message",
    value: failureWith((result) => {
      delete errorOf(result)["message"];
    }),
    path: "/error",
    keyword: "required",
  },
  {
    name: "empty error message",
    value: failureWith((result) => {
      errorOf(result)["message"] = "";
    }),
    path: "/error/message",
    keyword: "minLength",
  },
  {
    name: "missing error retryable",
    value: failureWith((result) => {
      delete errorOf(result)["retryable"];
    }),
    path: "/error",
    keyword: "required",
  },
  {
    name: "missing error attempts",
    value: failureWith((result) => {
      delete errorOf(result)["attempts"];
    }),
    path: "/error",
    keyword: "required",
  },
  {
    name: "zero error attempts",
    value: failureWith((result) => {
      errorOf(result)["attempts"] = 0;
    }),
    path: "/error/attempts",
    keyword: "minimum",
  },
  {
    name: "fractional error attempts",
    value: failureWith((result) => {
      errorOf(result)["attempts"] = 1.5;
    }),
    path: "/error/attempts",
    keyword: "type",
  },
  {
    name: "retryable contradicts a terminal code",
    value: failureWith((result) => {
      errorOf(result)["code"] = "INVALID_MESSAGE";
      errorOf(result)["retryable"] = true;
    }),
    path: "/error/retryable",
    keyword: "const",
  },
  {
    name: "retryable contradicts a transient code",
    value: failureWith((result) => {
      errorOf(result)["code"] = "DELIVERY_FAILED";
      errorOf(result)["retryable"] = false;
    }),
    path: "/error/retryable",
    keyword: "const",
  },
  {
    name: "success result carrying a failure error",
    value: successWith((result) => {
      result["error"] = {
        code: "INVALID_MESSAGE",
        message: "not used on success",
        retryable: false,
        attempts: 1,
      };
    }),
    path: "/",
    keyword: "additionalProperties",
  },
  {
    name: "failure result carrying a success hash",
    value: failureWith((result) => {
      result["sha256"] = PDF_HASH;
    }),
    path: "/",
    keyword: "additionalProperties",
  },
];
