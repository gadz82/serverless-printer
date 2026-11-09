import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateResult } from "../../packages/contracts/src/index.js";
import type {
  PrintFailureResult,
  PrintJob,
  PrintSuccessResult,
} from "../../packages/contracts/src/index.js";
import { PdfRenderFailed } from "../../packages/domain/src/index.js";
import { fifoIdentifiers } from "../../apps/render-worker/src/adapters/sqs-result-delivery.js";
import { composeWorker } from "../../apps/render-worker/src/composition-root.js";
import type { WorkerRuntime } from "../../apps/render-worker/src/composition-root.js";
import { createSqsHandler } from "../../apps/render-worker/src/handler.js";
import type { SqsHandler } from "../../apps/render-worker/src/handler.js";
import {
  assertLocalStackReachable,
  AWS_REGION,
  createBucket,
  createManifestRoot,
  createQueue,
  createS3Client,
  createSqsClient,
  deleteBucket,
  deleteMessage,
  deleteQueue,
  LOCALSTACK_ENDPOINT,
  readObject,
  receiveMessages,
  removeManifestRoot,
  S3_ENDPOINT,
  sendMessage,
  toSqsEvent,
  uniqueRunId,
  waitForMessage,
} from "./support/localstack.js";
import type { ManifestRoot, QueueHandle, ReceivedMessage } from "./support/localstack.js";

const TEST_TIMEOUT_MILLISECONDS = 30_000;
const RUN_ID = uniqueRunId();
const BUCKET = `printer-it-${RUN_ID}-prints`;

const sqs = createSqsClient();
const s3 = createS3Client();
const queues: QueueHandle[] = [];
let manifestRoot: ManifestRoot | undefined;
let jobsQueue: QueueHandle;
let successQueue: QueueHandle;
let failureQueue: QueueHandle;
let retryableQueue: QueueHandle;
let lastAttemptQueue: QueueHandle;
let fifoQueue: QueueHandle;
let handler: SqsHandler;
let failingHandler: SqsHandler;

beforeAll(async () => {
  await assertLocalStackReachable(sqs);
  manifestRoot = await createManifestRoot(`it-${RUN_ID}`);
  await createBucket(s3, BUCKET);

  const prefix = `printer-it-${RUN_ID}`;
  jobsQueue = await trackQueue(`${prefix}-jobs`, { VisibilityTimeout: "30" });
  successQueue = await trackQueue(`${prefix}-success`);
  failureQueue = await trackQueue(`${prefix}-failure`);
  retryableQueue = await trackQueue(`${prefix}-retryable`);
  lastAttemptQueue = await trackQueue(`${prefix}-last-attempt`);
  fifoQueue = await trackQueue(`${prefix}-fifo.fifo`, {
    FifoQueue: "true",
    ContentBasedDeduplication: "false",
  });

  process.env.AWS_ENDPOINT_URL ??= LOCALSTACK_ENDPOINT;
  process.env.AWS_ENDPOINT_URL_S3 ??= S3_ENDPOINT;
  process.env.AWS_REGION ??= AWS_REGION;
  process.env.AWS_ACCESS_KEY_ID ??= "test";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test";

  const workerEnv = {
    ...process.env,
    PRINTS_BUCKET: BUCKET,
    TEMPLATE_MANIFEST_PATH: manifestRoot.manifestPath,
    SQS_ENDPOINT_URL: LOCALSTACK_ENDPOINT,
    AWS_ENDPOINT_URL: LOCALSTACK_ENDPOINT,
    AWS_ENDPOINT_URL_S3: S3_ENDPOINT,
    AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test",
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    MAX_RECEIVE_COUNT: "5",
    PRESIGN_TTL_SECONDS: "900",
  };

  const runtime: WorkerRuntime = composeWorker(workerEnv);
  handler = createSqsHandler(() => runtime);

  const failingRuntime: WorkerRuntime = composeWorker(workerEnv, {
    pdfRenderer: {
      async render() {
        throw new PdfRenderFailed("forced integration render failure");
      },
    },
  });
  failingHandler = createSqsHandler(() => failingRuntime);
}, 60_000);

afterAll(async () => {
  const cleanup = await Promise.allSettled([
    ...queues.map((queue) => deleteQueue(sqs, queue)),
    deleteBucket(s3, BUCKET),
    removeManifestRoot(manifestRoot),
  ]);

  for (const result of cleanup) {
    if (result.status === "rejected") {
      console.warn(`Integration cleanup failed: ${String(result.reason)}`);
    }
  }
}, 30_000);

describe.sequential("local worker integration", () => {
  it(
    "stores a PDF in S3 and delivers a success result with a presigned URL",
    async () => {
      const refId = `success-${RUN_ID}`;
      const message = await enqueue({
        templateId: "_smoke",
        refId,
        webhooks: { success: sqsWebhook(successQueue) },
        payload: { message: "Printer smoke" },
      });

      const response = await handler(toSqsEvent([message], jobsQueue.arn));
      expect(response).toEqual({ batchItemFailures: [] });
      await deleteMessage(sqs, jobsQueue.url, message);

      const resultMessage = await waitForResult(successQueue, refId);
      const result = parseSuccessResult(resultMessage);
      const printing = result.printing;
      if (printing === undefined) {
        throw new Error("success result did not include a presigned printing URL");
      }

      // LocalStack issues http:// presigned URLs, so the production HTTPS
      // contract is deliberately not asserted for this local result.
      expect(result).toMatchObject({
        success: true,
        refId,
        pdfA: null,
        template: { slug: "_smoke", release: `it-${RUN_ID}` },
      });
      expect(result.printId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      const printingUrl = new URL(printing);
      expect(printingUrl.protocol).toBe("http:");
      expect(decodeURIComponent(printingUrl.pathname)).toContain(`prints/${result.printId}.pdf`);
      expect(printingUrl.searchParams.get("X-Amz-Signature")).toBeTruthy();

      // LocalStack presigns over http; the production contract requires https.
      // Normalize only the scheme so the rest of the result is still validated.
      expect(
        validateResult({
          ...result,
          printing: printing.replace(/^http:\/\//, "https://"),
        }),
      ).toBe(true);

      const stored = await readObject(s3, BUCKET, `prints/${result.printId}.pdf`);
      expect(stored.byteLength).toBe(result.sizeBytes);
      expect(sha256Hex(stored)).toBe(result.sha256);

      const download = await fetch(printing);
      expect(download.status).toBe(200);
      expect(sha256Hex(new Uint8Array(await download.arrayBuffer()))).toBe(result.sha256);

      await deleteMessage(sqs, successQueue.url, resultMessage);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    "delivers a readable INVALID_MESSAGE failure through the SQS callback",
    async () => {
      const refId = `invalid-${RUN_ID}`;
      const message = await enqueueRaw({
        refId,
        webhooks: { failure: sqsWebhook(failureQueue) },
      });

      const response = await handler(toSqsEvent([message], jobsQueue.arn));
      expect(response).toEqual({ batchItemFailures: [] });
      await deleteMessage(sqs, jobsQueue.url, message);

      const resultMessage = await waitForResult(failureQueue, refId);
      const result = parseFailureResult(resultMessage);

      expect(validateResult(result)).toBe(true);
      expect(result).toMatchObject({
        success: false,
        refId,
        template: null,
        error: { code: "INVALID_MESSAGE", retryable: false, attempts: 1 },
      });
      expect(result.error.message).toContain("templateId");
      expect(result.error.message).toContain("webhooks");

      await deleteMessage(sqs, failureQueue.url, resultMessage);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    "delivers TEMPLATE_NOT_FOUND without retrying",
    async () => {
      const refId = `unknown-${RUN_ID}`;
      const message = await enqueue({
        templateId: "missing-template",
        refId,
        webhooks: {
          success: sqsWebhook(successQueue),
          failure: sqsWebhook(failureQueue),
        },
      });

      const response = await handler(toSqsEvent([message], jobsQueue.arn));
      expect(response).toEqual({ batchItemFailures: [] });
      await deleteMessage(sqs, jobsQueue.url, message);

      const resultMessage = await waitForResult(failureQueue, refId);
      const result = parseFailureResult(resultMessage);

      expect(validateResult(result)).toBe(true);
      expect(result).toMatchObject({
        success: false,
        refId,
        template: null,
        error: { code: "TEMPLATE_NOT_FOUND", retryable: false, attempts: 1 },
      });

      await deleteMessage(sqs, failureQueue.url, resultMessage);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    "returns a batch item failure for a retryable render error",
    async () => {
      const refId = `retry-${RUN_ID}`;
      const message = await enqueue({
        templateId: "_smoke",
        refId,
        webhooks: {
          success: sqsWebhook(retryableQueue),
          failure: sqsWebhook(retryableQueue),
        },
      });

      const response = await failingHandler(toSqsEvent([message], jobsQueue.arn, 1));

      expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: message.MessageId }] });
      expect(await receiveMessages(sqs, retryableQueue.url, 1)).toHaveLength(0);

      await deleteMessage(sqs, jobsQueue.url, message);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    "delivers the final failure result on the last attempt without a batch item failure",
    async () => {
      const refId = `last-attempt-${RUN_ID}`;
      const message = await enqueue({
        templateId: "_smoke",
        refId,
        webhooks: {
          success: sqsWebhook(successQueue),
          failure: sqsWebhook(lastAttemptQueue),
        },
      });

      const response = await failingHandler(toSqsEvent([message], jobsQueue.arn, 5));
      expect(response).toEqual({ batchItemFailures: [] });
      await deleteMessage(sqs, jobsQueue.url, message);

      const resultMessage = await waitForResult(lastAttemptQueue, refId);
      const result = parseFailureResult(resultMessage);

      expect(validateResult(result)).toBe(true);
      expect(result).toMatchObject({
        success: false,
        refId,
        template: { slug: "_smoke" },
        error: { code: "PDF_RENDER_FAILED", retryable: true, attempts: 5 },
      });

      await deleteMessage(sqs, lastAttemptQueue.url, resultMessage);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );

  it(
    "sets FIFO message group and deduplication identifiers on the callback",
    async () => {
      const refId = `fifo-${RUN_ID}`;
      const message = await enqueue({
        templateId: "_smoke",
        refId,
        webhooks: { success: sqsWebhook(fifoQueue) },
      });

      const response = await handler(toSqsEvent([message], jobsQueue.arn));
      expect(response).toEqual({ batchItemFailures: [] });
      await deleteMessage(sqs, jobsQueue.url, message);

      const resultMessage = await waitForResult(fifoQueue, refId);
      const expected = fifoIdentifiers(refId, message.MessageId ?? "");

      expect(resultMessage.Attributes?.MessageGroupId).toBe(expected.messageGroupId);
      expect(resultMessage.Attributes?.MessageDeduplicationId).toBe(
        expected.messageDeduplicationId,
      );
      expect(parseSuccessResult(resultMessage).success).toBe(true);

      await deleteMessage(sqs, fifoQueue.url, resultMessage);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );
});

async function trackQueue(name: string, attributes: Record<string, string> = {}) {
  const queue = await createQueue(sqs, name, attributes);
  queues.push(queue);
  return queue;
}

function sqsWebhook(queue: QueueHandle) {
  return { channel: "sqs" as const, value: queue.arn };
}

async function enqueue(job: PrintJob): Promise<ReceivedMessage> {
  return enqueueRaw(job);
}

async function enqueueRaw(body: unknown): Promise<ReceivedMessage> {
  await sendMessage(sqs, jobsQueue.url, JSON.stringify(body));
  const message = await waitForMessage(sqs, jobsQueue.url, () => true, 10_000);

  if (message === undefined) {
    throw new Error("timed out waiting for the job message from LocalStack SQS");
  }

  return message;
}

async function waitForResult(queue: QueueHandle, refId: string): Promise<ReceivedMessage> {
  const message = await waitForMessage(
    sqs,
    queue.url,
    (candidate) => readRefId(candidate) === refId,
    15_000,
  );

  if (message === undefined) {
    throw new Error(`timed out waiting for result ${refId} on ${queue.name}`);
  }

  return message;
}

function readRefId(message: ReceivedMessage): unknown {
  try {
    return (JSON.parse(message.Body ?? "") as { refId?: unknown }).refId;
  } catch {
    return undefined;
  }
}

function parseSuccessResult(message: ReceivedMessage): PrintSuccessResult {
  const result = JSON.parse(message.Body ?? "{}") as PrintSuccessResult;
  if (result.success !== true) {
    throw new Error("expected a success result");
  }
  return result;
}

function parseFailureResult(message: ReceivedMessage): PrintFailureResult {
  const result = JSON.parse(message.Body ?? "{}") as PrintFailureResult;
  if (result.success !== false) {
    throw new Error("expected a failure result");
  }
  return result;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
