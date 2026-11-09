import type { SQSEvent, SQSRecord } from "aws-lambda";
import { validateResult } from "@printer/contracts";
import { PdfRenderFailed, ProcessPrintJob } from "@printer/domain";
import type { PrintResult } from "@printer/domain";
import { describe, expect, it } from "vitest";
import type { WorkerRuntime } from "../src/composition-root.js";
import { loadConfig } from "../src/config.js";
import { createSqsHandler } from "../src/handler.js";
import {
  CapturingLogger,
  FixedClock,
  FixedIdGenerator,
  FixedPrintRepository,
  InMemoryTemplateCatalog,
  PDF_BYTES,
  RecordingResultDelivery,
  ScriptedPdfRenderer,
} from "./support/fakes.js";

const SUCCESS_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-results";
const FAILURE_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-failures";

type RuntimeOptions = {
  readonly renderer?: () => Promise<Uint8Array>;
  readonly deliveryFails?: (result: PrintResult) => boolean;
  readonly maxReceiveCount?: string;
};

function buildRuntime(options: RuntimeOptions = {}): {
  runtime: WorkerRuntime;
  delivery: RecordingResultDelivery;
  logger: CapturingLogger;
} {
  const config = loadConfig({
    PRINTS_BUCKET: "printer-prints",
    MAX_RECEIVE_COUNT: options.maxReceiveCount ?? "3",
  });
  const delivery = new RecordingResultDelivery(options.deliveryFails);
  const logger = new CapturingLogger();
  const clock = new FixedClock();
  const idGenerator = new FixedIdGenerator();
  const processPrintJob = new ProcessPrintJob({
    templateCatalog: new InMemoryTemplateCatalog(),
    pdfRenderer: new ScriptedPdfRenderer(options.renderer ?? (async () => PDF_BYTES)),
    printRepository: new FixedPrintRepository(),
    resultDelivery: delivery,
    clock,
    idGenerator,
    logger,
    supportedChannels: ["sqs"],
    pdfaAllowedLevels: [],
  });

  return {
    runtime: {
      config,
      processPrintJob,
      resultDelivery: delivery,
      idGenerator,
      clock,
      logger,
    },
    delivery,
    logger,
  };
}

function record(body: unknown, receiveCount = "1", messageId = "message-1"): SQSRecord {
  return {
    messageId,
    receiptHandle: "receipt-handle",
    body: typeof body === "string" ? body : JSON.stringify(body),
    attributes: {
      ApproximateReceiveCount: receiveCount,
      SentTimestamp: "0",
      SenderId: "sender",
      ApproximateFirstReceiveTimestamp: "0",
    },
    messageAttributes: {},
    md5OfBody: "md5",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:eu-central-1:123456789012:printer-jobs",
    awsRegion: "eu-central-1",
  };
}

function event(records: readonly SQSRecord[]): SQSEvent {
  return { Records: [...records] };
}

function validJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    templateId: "_smoke",
    refId: "invoice-1",
    webhooks: {
      success: { channel: "sqs", value: SUCCESS_ARN },
      failure: { channel: "sqs", value: FAILURE_ARN },
    },
    ...overrides,
  };
}

describe("SQS handler", () => {
  it("returns no batch failures and delivers one success result for a valid job", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);

    const response = await handler(event([record(validJob())]));

    expect(response).toEqual({ batchItemFailures: [] });
    expect(delivery.deliveries).toHaveLength(1);
    const result = delivery.deliveries[0]?.result;
    expect(result?.success).toBe(true);
    expect(validateResult(result)).toBe(true);
    expect(result).toMatchObject({
      success: true,
      printId: "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c",
      pdfA: null,
      template: { slug: "_smoke" },
    });
  });

  it("reports invalid JSON for retry because no failure webhook can be read", async () => {
    const { runtime, delivery, logger } = buildRuntime();
    const handler = createSqsHandler(() => runtime);

    const response = await handler(event([record("{not-json")]));

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(delivery.deliveries).toHaveLength(0);
    expect(logger.entries).toContainEqual({
      level: "error",
      event: "print_job_invalid_message",
      fields: expect.objectContaining({ errorCode: "INVALID_MESSAGE", attempt: 1 }),
    });
  });

  it.each([
    {
      location: "refId",
      body: `{"refId":1e400,"webhooks":{"failure":{"channel":"sqs","value":"${FAILURE_ARN}"}}}`,
    },
    {
      location: "nested payload",
      body: `{"refId":"invoice-1","payload":{"amount":1e400},"webhooks":{"failure":{"channel":"sqs","value":"${FAILURE_ARN}"}}}`,
    },
  ])("reports a non-finite number in $location as invalid JSON", async ({ body }) => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);

    const response = await handler(event([record(body)]));

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(delivery.deliveries).toHaveLength(0);
  });

  it("delivers INVALID_MESSAGE when a schema-invalid message has a readable failure webhook", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);
    const invalid = {
      refId: "keep-me",
      webhooks: {
        failure: { channel: "sqs", value: FAILURE_ARN },
      },
    };

    const response = await handler(event([record(invalid, "2")]));

    expect(response).toEqual({ batchItemFailures: [] });
    expect(delivery.deliveries).toHaveLength(1);
    const result = delivery.deliveries[0]?.result;
    expect(validateResult(result)).toBe(true);
    expect(result).toMatchObject({
      success: false,
      printId: "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c",
      refId: "keep-me",
      template: null,
      error: { code: "INVALID_MESSAGE", retryable: false, attempts: 2 },
    });
  });

  it("reports a schema-invalid message without a readable SQS failure webhook", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);

    const response = await handler(event([record({ refId: "keep-me" })]));

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(delivery.deliveries).toHaveLength(0);
  });

  it("falls back to the message id when an invalid message has no usable refId", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);
    const invalid = {
      refId: ["not", "a", "valid", "ref"],
      webhooks: {
        failure: { channel: "sqs", value: FAILURE_ARN },
      },
    };

    const response = await handler(event([record(invalid)]));

    expect(response).toEqual({ batchItemFailures: [] });
    expect(delivery.deliveries).toHaveLength(1);
    const result = delivery.deliveries[0]?.result;
    expect(validateResult(result)).toBe(true);
    expect(result).toMatchObject({ success: false, refId: "message-1" });
  });

  it("treats a non-SQS failure webhook as unreadable in Phase 1", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);
    const invalid = {
      refId: "keep-me",
      webhooks: {
        failure: { channel: "http", value: "https://callbacks.example.com/failure" },
      },
    };

    const response = await handler(event([record(invalid)]));

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(delivery.deliveries).toHaveLength(0);
  });

  it("delivers a non-retryable failure and does not report a batch failure", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);

    const response = await handler(event([record(validJob({ templateId: "missing-template" }))]));

    expect(response).toEqual({ batchItemFailures: [] });
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.result).toMatchObject({
      success: false,
      error: { code: "TEMPLATE_NOT_FOUND", retryable: false, attempts: 1 },
    });
  });

  it("reports a batch failure when a non-retryable failure has no failure callback", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);

    const response = await handler(
      event([
        record(
          validJob({
            templateId: "missing-template",
            webhooks: { success: { channel: "sqs", value: SUCCESS_ARN } },
          }),
        ),
      ]),
    );

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(delivery.deliveries).toHaveLength(0);
  });

  it("reports a retryable failure before the last attempt", async () => {
    const { runtime, delivery, logger } = buildRuntime({
      renderer: async () => {
        throw new PdfRenderFailed("renderer exploded");
      },
      maxReceiveCount: "3",
    });
    const handler = createSqsHandler(() => runtime);

    const response = await handler(event([record(validJob(), "1")]));

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(delivery.deliveries).toHaveLength(0);
    expect(logger.entries).toContainEqual({
      level: "warn",
      event: "print_job_retry",
      fields: expect.objectContaining({ errorCode: "PDF_RENDER_FAILED", attempt: 1 }),
    });
  });

  it("delivers the failure result on the last attempt", async () => {
    const { runtime, delivery } = buildRuntime({
      renderer: async () => {
        throw new PdfRenderFailed("renderer exploded");
      },
      maxReceiveCount: "3",
    });
    const handler = createSqsHandler(() => runtime);

    const response = await handler(event([record(validJob(), "3")]));

    expect(response).toEqual({ batchItemFailures: [] });
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.result).toMatchObject({
      success: false,
      error: { code: "PDF_RENDER_FAILED", retryable: true, attempts: 3 },
    });
  });

  it("reports a batch failure when the last-attempt failure result cannot be delivered", async () => {
    const { runtime, delivery } = buildRuntime({
      renderer: async () => {
        throw new PdfRenderFailed("renderer exploded");
      },
      deliveryFails: (result) => !result.success,
      maxReceiveCount: "3",
    });
    const handler = createSqsHandler(() => runtime);

    const response = await handler(event([record(validJob(), "3")]));

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(delivery.deliveries).toHaveLength(1);
  });

  it("delivers CALLBACK_NOT_ALLOWED for an unsupported success channel", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);

    const response = await handler(
      event([
        record(
          validJob({
            webhooks: {
              success: { channel: "http", value: "https://callbacks.example.com/print" },
              failure: { channel: "sqs", value: FAILURE_ARN },
            },
          }),
        ),
      ]),
    );

    expect(response).toEqual({ batchItemFailures: [] });
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.result).toMatchObject({
      success: false,
      error: { code: "CALLBACK_NOT_ALLOWED", retryable: false },
    });
  });

  it("processes records sequentially and reports only the failed item", async () => {
    const { runtime, delivery } = buildRuntime();
    const handler = createSqsHandler(() => runtime);

    const response = await handler(
      event([
        record("{not-json", "1", "message-1"),
        record(validJob({ templateId: "missing-template" }), "1", "message-2"),
      ]),
    );

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: "message-1" }] });
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.result).toMatchObject({
      success: false,
      error: { code: "TEMPLATE_NOT_FOUND" },
    });
  });

  it("uses ApproximateReceiveCount as the attempt and clamps invalid counts to one", async () => {
    const { runtime, delivery } = buildRuntime({ maxReceiveCount: "5" });
    const handler = createSqsHandler(() => runtime);

    await handler(event([record(validJob({ templateId: "missing-template" }), "not-a-number")]));

    expect(delivery.deliveries[0]?.result).toMatchObject({
      success: false,
      error: { attempts: 1 },
    });
  });
});
