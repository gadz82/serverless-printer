import type { PrintJob } from "../../src/index.js";

const HTTPS_CALLBACK = "https://callbacks.example.com/print";
const HTTPS_PING = "https://callbacks.example.com/ping";
const LAMBDA_ARN = "arn:aws:lambda:eu-central-1:123456789012:function:printer-callback";
const SQS_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-results";
const FIFO_SQS_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-results.fifo";
const EVENT_BUS_ARN = "arn:aws:events:eu-central-1:123456789012:event-bus/printer";
const S3_PRESIGNED_PUT =
  "https://printer-prints.s3.eu-central-1.amazonaws.com/prints/job.pdf" +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
  "&X-Amz-Credential=AKIAEXAMPLE%2F20261109%2Feu-central-1%2Fs3%2Faws4_request" +
  "&X-Amz-Date=20261109T100000Z" +
  "&X-Amz-Expires=900" +
  "&X-Amz-SignedHeaders=host" +
  "&X-Amz-Signature=0123456789abcdef";

export const minimalJob = {
  templateId: "annual-statement",
  refId: "invoice-2026-0001",
  webhooks: {
    success: {
      channel: "sqs",
      value: SQS_ARN,
    },
  },
} satisfies PrintJob;

export const uuidJob = {
  templateId: "6f1c2b0e-8a4d-4f7e-9c1a-2d3b4e5f6a7b",
  refId: 42,
  webhooks: {
    success: {
      channel: "sqs",
      value: SQS_ARN,
    },
  },
} satisfies PrintJob;

export const smokeJob = {
  templateId: "_smoke",
  refId: {
    suite: "release-smoke",
    run: 17,
  },
  webhooks: {
    success: {
      channel: "sqs",
      value: SQS_ARN,
    },
  },
} satisfies PrintJob;

export const fullHttpJob = {
  templateId: "annual-statement",
  refId: "invoice-2026-0002",
  options: {
    pdfA: "PDF/A-2b",
  },
  webhooks: {
    success: {
      pingUrl: HTTPS_PING,
      channel: "http",
      value: HTTPS_CALLBACK,
    },
    failure: {
      pingUrl: null,
      channel: "http",
      value: "https://callbacks.example.com/failure",
    },
  },
  payload: {
    customer: {
      name: "Ada Lovelace",
    },
    lines: [{ description: "Consulting", amount: 1200 }],
  },
} satisfies PrintJob;

export const httpChannelJob = {
  templateId: "annual-statement",
  refId: "http-1",
  webhooks: {
    success: {
      pingUrl: HTTPS_PING,
      channel: "http",
      value: HTTPS_CALLBACK,
    },
    failure: {
      channel: "http",
      value: "https://callbacks.example.com/failure",
    },
  },
} satisfies PrintJob;

export const lambdaChannelJob = {
  templateId: "annual-statement",
  refId: "lambda-1",
  webhooks: {
    success: {
      channel: "lambda",
      value: LAMBDA_ARN,
    },
    failure: {
      channel: "lambda",
      value: LAMBDA_ARN,
    },
  },
} satisfies PrintJob;

export const sqsChannelJob = {
  templateId: "annual-statement",
  refId: "sqs-1",
  webhooks: {
    success: {
      channel: "sqs",
      value: FIFO_SQS_ARN,
    },
    failure: {
      channel: "sqs",
      value: SQS_ARN,
    },
  },
} satisfies PrintJob;

export const eventBridgeChannelJob = {
  templateId: "annual-statement",
  refId: "event-bridge-1",
  webhooks: {
    success: {
      channel: "eventBridge",
      value: EVENT_BUS_ARN,
    },
    failure: {
      channel: "eventBridge",
      value: EVENT_BUS_ARN,
    },
  },
} satisfies PrintJob;

export const s3ChannelJob = {
  templateId: "annual-statement",
  refId: "s3-1",
  webhooks: {
    success: {
      pingUrl: HTTPS_PING,
      channel: "s3",
      value: S3_PRESIGNED_PUT,
    },
    failure: {
      channel: "sqs",
      value: SQS_ARN,
    },
  },
} satisfies PrintJob;

export const validJobFixtures = [
  { name: "minimal job", value: minimalJob },
  { name: "uuid template id and numeric refId", value: uuidJob },
  { name: "reserved _smoke template id and object refId", value: smokeJob },
  { name: "full job with options, payload and failure webhook", value: fullHttpJob },
  { name: "http success and failure channels", value: httpChannelJob },
  { name: "lambda success and failure channels", value: lambdaChannelJob },
  { name: "sqs success and failure channels", value: sqsChannelJob },
  { name: "eventBridge success and failure channels", value: eventBridgeChannelJob },
  { name: "s3 success channel and sqs failure channel", value: s3ChannelJob },
] as const;

export type InvalidFixture = {
  readonly name: string;
  readonly value: unknown;
  readonly path: string;
  readonly keyword: string;
};

type UnknownRecord = Record<string, unknown>;

function cloneJob(): UnknownRecord {
  return structuredClone(minimalJob) as unknown as UnknownRecord;
}

function jobWith(change: (job: UnknownRecord) => void): unknown {
  const job = cloneJob();
  change(job);
  return job;
}

function webhooksOf(job: UnknownRecord): UnknownRecord {
  return job["webhooks"] as UnknownRecord;
}

function successOf(job: UnknownRecord): UnknownRecord {
  return webhooksOf(job)["success"] as UnknownRecord;
}

function successWith(change: (success: UnknownRecord) => void): unknown {
  return jobWith((job) => {
    change(successOf(job));
  });
}

function failureChannel(value: string): unknown {
  return jobWith((job) => {
    webhooksOf(job)["failure"] = {
      channel: value,
      value: SQS_ARN,
    };
  });
}

export const invalidJobFixtures: readonly InvalidFixture[] = [
  {
    name: "missing templateId",
    value: jobWith((job) => {
      delete job["templateId"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "missing refId",
    value: jobWith((job) => {
      delete job["refId"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "missing webhooks",
    value: jobWith((job) => {
      delete job["webhooks"];
    }),
    path: "/",
    keyword: "required",
  },
  {
    name: "missing webhooks.success",
    value: jobWith((job) => {
      webhooksOf(job)["failure"] = { channel: "sqs", value: SQS_ARN };
      delete webhooksOf(job)["success"];
    }),
    path: "/webhooks",
    keyword: "required",
  },
  {
    name: "missing success channel",
    value: successWith((success) => {
      delete success["channel"];
    }),
    path: "/webhooks/success",
    keyword: "required",
  },
  {
    name: "missing success value",
    value: successWith((success) => {
      delete success["value"];
    }),
    path: "/webhooks/success",
    keyword: "required",
  },
  {
    name: "missing failure channel",
    value: jobWith((job) => {
      webhooksOf(job)["failure"] = { value: SQS_ARN };
    }),
    path: "/webhooks/failure",
    keyword: "required",
  },
  {
    name: "missing failure value",
    value: jobWith((job) => {
      webhooksOf(job)["failure"] = { channel: "sqs" };
    }),
    path: "/webhooks/failure",
    keyword: "required",
  },
  {
    name: "empty success value",
    value: successWith((success) => {
      success["value"] = "";
    }),
    path: "/webhooks/success/value",
    keyword: "minLength",
  },
  {
    name: "unknown failure webhook field",
    value: jobWith((job) => {
      webhooksOf(job)["failure"] = {
        channel: "sqs",
        value: SQS_ARN,
        url: HTTPS_CALLBACK,
      };
    }),
    path: "/webhooks/failure",
    keyword: "additionalProperties",
  },
  {
    name: "non-string templateId",
    value: jobWith((job) => {
      job["templateId"] = 42;
    }),
    path: "/templateId",
    keyword: "type",
  },
  {
    name: "empty templateId",
    value: jobWith((job) => {
      job["templateId"] = "";
    }),
    path: "/templateId",
    keyword: "minLength",
  },
  {
    name: "templateId longer than 128 characters",
    value: jobWith((job) => {
      job["templateId"] = `a${"b".repeat(128)}`;
    }),
    path: "/templateId",
    keyword: "maxLength",
  },
  {
    name: "uppercase slug",
    value: jobWith((job) => {
      job["templateId"] = "Annual-Statement";
    }),
    path: "/templateId",
    keyword: "pattern",
  },
  {
    name: "two-character slug",
    value: jobWith((job) => {
      job["templateId"] = "ab";
    }),
    path: "/templateId",
    keyword: "pattern",
  },
  {
    name: "slug with leading hyphen",
    value: jobWith((job) => {
      job["templateId"] = "-annual-statement";
    }),
    path: "/templateId",
    keyword: "pattern",
  },
  {
    name: "truncated uuid",
    value: jobWith((job) => {
      job["templateId"] = "6f1c2b0e-8a4d-4f7e-9c1a";
    }),
    path: "/templateId",
    keyword: "pattern",
  },
  {
    name: "reserved-looking slug that is not _smoke",
    value: jobWith((job) => {
      job["templateId"] = "_smoke-test";
    }),
    path: "/templateId",
    keyword: "pattern",
  },
  {
    name: "refId array",
    value: jobWith((job) => {
      job["refId"] = [1, 2, 3];
    }),
    path: "/refId",
    keyword: "oneOf",
  },
  {
    name: "refId boolean",
    value: jobWith((job) => {
      job["refId"] = true;
    }),
    path: "/refId",
    keyword: "oneOf",
  },
  {
    name: "refId null",
    value: jobWith((job) => {
      job["refId"] = null;
    }),
    path: "/refId",
    keyword: "oneOf",
  },
  {
    name: "null options",
    value: jobWith((job) => {
      job["options"] = null;
    }),
    path: "/options",
    keyword: "type",
  },
  {
    name: "pdfA true",
    value: jobWith((job) => {
      job["options"] = { pdfA: true };
    }),
    path: "/options/pdfA",
    keyword: "enum",
  },
  {
    name: "unknown pdfA level",
    value: jobWith((job) => {
      job["options"] = { pdfA: "PDF/A-4b" };
    }),
    path: "/options/pdfA",
    keyword: "enum",
  },
  {
    name: "lowercase pdfA level",
    value: jobWith((job) => {
      job["options"] = { pdfA: "pdf/a-2b" };
    }),
    path: "/options/pdfA",
    keyword: "enum",
  },
  {
    name: "non-string pdfA",
    value: jobWith((job) => {
      job["options"] = { pdfA: 2 };
    }),
    path: "/options/pdfA",
    keyword: "enum",
  },
  {
    name: "unknown top-level field",
    value: jobWith((job) => {
      job["templateID"] = "annual-statement";
    }),
    path: "/",
    keyword: "additionalProperties",
  },
  {
    name: "unknown options field",
    value: jobWith((job) => {
      job["options"] = { pdfa: "PDF/A-2b" };
    }),
    path: "/options",
    keyword: "additionalProperties",
  },
  {
    name: "unknown webhooks field",
    value: jobWith((job) => {
      webhooksOf(job)["successUrl"] = HTTPS_CALLBACK;
    }),
    path: "/webhooks",
    keyword: "additionalProperties",
  },
  {
    name: "unknown success webhook field",
    value: successWith((success) => {
      success["url"] = HTTPS_CALLBACK;
    }),
    path: "/webhooks/success",
    keyword: "additionalProperties",
  },
  {
    name: "payload array",
    value: jobWith((job) => {
      job["payload"] = [];
    }),
    path: "/payload",
    keyword: "type",
  },
  {
    name: "http success value is not HTTPS",
    value: successWith((success) => {
      success["channel"] = "http";
      success["value"] = "http://callbacks.example.com/print";
    }),
    path: "/webhooks/success/value",
    keyword: "pattern",
  },
  {
    name: "http success value has no scheme",
    value: successWith((success) => {
      success["channel"] = "http";
      success["value"] = "callbacks.example.com/print";
    }),
    path: "/webhooks/success/value",
    keyword: "pattern",
  },
  {
    name: "pingUrl is not HTTPS",
    value: successWith((success) => {
      success["pingUrl"] = "http://callbacks.example.com/ping";
    }),
    path: "/webhooks/success/pingUrl",
    keyword: "pattern",
  },
  {
    name: "pingUrl is not a string",
    value: successWith((success) => {
      success["pingUrl"] = 123;
    }),
    path: "/webhooks/success/pingUrl",
    keyword: "anyOf",
  },
  {
    name: "lambda success value is an HTTPS URL",
    value: successWith((success) => {
      success["channel"] = "lambda";
      success["value"] = HTTPS_CALLBACK;
    }),
    path: "/webhooks/success/value",
    keyword: "pattern",
  },
  {
    name: "lambda success value is a sqs ARN",
    value: successWith((success) => {
      success["channel"] = "lambda";
      success["value"] = SQS_ARN;
    }),
    path: "/webhooks/success/value",
    keyword: "pattern",
  },
  {
    name: "sqs success value is a lambda ARN",
    value: successWith((success) => {
      success["channel"] = "sqs";
      success["value"] = LAMBDA_ARN;
    }),
    path: "/webhooks/success/value",
    keyword: "pattern",
  },
  {
    name: "eventBridge success value is a sqs ARN",
    value: successWith((success) => {
      success["channel"] = "eventBridge";
      success["value"] = SQS_ARN;
    }),
    path: "/webhooks/success/value",
    keyword: "pattern",
  },
  {
    name: "s3 success value is not presigned",
    value: successWith((success) => {
      success["channel"] = "s3";
      success["value"] = "https://printer-prints.s3.eu-central-1.amazonaws.com/prints/job.pdf";
    }),
    path: "/webhooks/success/value",
    keyword: "pattern",
  },
  {
    name: "s3 success value is not HTTPS",
    value: successWith((success) => {
      success["channel"] = "s3";
      success["value"] = `${S3_PRESIGNED_PUT.replace("https://", "http://")}`;
    }),
    path: "/webhooks/success/value",
    keyword: "pattern",
  },
  {
    name: "s3 failure channel",
    value: failureChannel("s3"),
    path: "/webhooks/failure/channel",
    keyword: "enum",
  },
  {
    name: "success webhook is not an object",
    value: jobWith((job) => {
      webhooksOf(job)["success"] = HTTPS_CALLBACK;
    }),
    path: "/webhooks/success",
    keyword: "type",
  },
  {
    name: "webhooks is an array",
    value: jobWith((job) => {
      job["webhooks"] = [];
    }),
    path: "/webhooks",
    keyword: "type",
  },
];
