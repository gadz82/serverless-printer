import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import {
  formatValidationErrors,
  validateJob,
  type PrintJob as ContractPrintJob,
} from "@printer/contracts";
import {
  isPrintJobError,
  type CallbackTarget,
  type ErrorCode,
  type PrintFailureResult,
  type PrintJob,
  type RefId,
} from "@printer/domain";
import type { WorkerRuntime } from "./composition-root.js";
import { composeWorker } from "./composition-root.js";
import { isSqsQueueArn } from "./adapters/sqs-result-delivery.js";

export type SqsHandler = (event: SQSEvent) => Promise<SQSBatchResponse>;

/**
 * Creates the Lambda entry point around a runtime provider. The real handler
 * memoizes the composition root once per cold start; tests supply a fake
 * runtime through the same seam.
 */
export function createSqsHandler(resolveRuntime: () => WorkerRuntime): SqsHandler {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const runtime = resolveRuntime();
    const batchItemFailures: SQSBatchItemFailure[] = [];

    // Records are processed one after another on the same invocation.
    for (const record of event.Records) {
      const failed = await processRecord(record, runtime);
      if (failed) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }

    return { batchItemFailures };
  };
}

async function processRecord(record: SQSRecord, runtime: WorkerRuntime): Promise<boolean> {
  const startedAt = Date.now();
  const attempt = receiveCount(record);
  const printId = runtime.idGenerator.forMessage(record.messageId);

  let raw: unknown;
  try {
    raw = parseMessageBody(record.body);
  } catch {
    log(runtime, "print_job_invalid_message", {
      messageId: record.messageId,
      printId,
      attempt,
      errorCode: "INVALID_MESSAGE",
      durationMs: Date.now() - startedAt,
    });
    return true;
  }

  if (!validateJob(raw)) {
    const failureTarget = readFailureTarget(raw);
    if (failureTarget === undefined) {
      log(runtime, "print_job_invalid_message", {
        messageId: record.messageId,
        printId,
        attempt,
        errorCode: "INVALID_MESSAGE",
        durationMs: Date.now() - startedAt,
      });
      return true;
    }

    const refId = readRefId(raw, record.messageId);
    const validationMessage = formatValidationErrors(validateJob.errors);
    const failure: PrintFailureResult = {
      success: false,
      printId,
      refId,
      template: null,
      error: {
        code: "INVALID_MESSAGE",
        message: validationMessage.length > 0 ? validationMessage : "invalid job contract",
        retryable: false,
        attempts: attempt,
      },
      failedAt: runtime.clock.now().toISOString(),
    };

    try {
      await runtime.resultDelivery.deliver(failure, {
        target: failureTarget,
        refId,
        messageId: record.messageId,
      });
    } catch {
      log(runtime, "print_job_invalid_message", {
        messageId: record.messageId,
        printId,
        attempt,
        errorCode: "INVALID_MESSAGE",
        durationMs: Date.now() - startedAt,
      });
      return true;
    }

    log(runtime, "print_job_invalid_message", {
      messageId: record.messageId,
      printId,
      attempt,
      errorCode: "INVALID_MESSAGE",
      durationMs: Date.now() - startedAt,
    });
    return false;
  }

  const job = toDomainJob(raw);
  try {
    await runtime.processPrintJob.execute({
      messageId: record.messageId,
      job,
      attempt,
      maxAttempts: runtime.config.maxReceiveCount,
    });
    return false;
  } catch (error) {
    log(runtime, "print_job_batch_failure", {
      messageId: record.messageId,
      printId,
      templateId: job.templateId,
      attempt,
      errorCode: isPrintJobError(error) ? error.code : "DELIVERY_FAILED",
      durationMs: Date.now() - startedAt,
    });
    return true;
  }
}

function receiveCount(record: SQSRecord): number {
  const parsed = Number.parseInt(record.attributes.ApproximateReceiveCount, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * JSON.parse turns `1e400` into Infinity. SQS bodies must contain finite JSON
 * numbers, so reject them during parsing and let the record follow the DLQ path.
 */
function parseMessageBody(body: string): unknown {
  return JSON.parse(body, (_key: string, value: unknown): unknown => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new SyntaxError("message body contains a non-finite number");
    }
    return value;
  });
}

function toDomainJob(job: ContractPrintJob): PrintJob {
  return {
    templateId: job.templateId,
    refId: job.refId,
    ...(job.options === undefined ? {} : { options: { ...job.options } }),
    webhooks: {
      success: toCallbackTarget(job.webhooks.success),
      ...(job.webhooks.failure === undefined
        ? {}
        : { failure: toCallbackTarget(job.webhooks.failure) }),
    },
    ...(job.payload === undefined ? {} : { payload: job.payload }),
  };
}

function toCallbackTarget(target: {
  readonly channel: PrintJob["webhooks"]["success"]["channel"];
  readonly value: string;
  readonly pingUrl?: string | null;
}): CallbackTarget {
  return {
    channel: target.channel,
    value: target.value,
    ...(target.pingUrl === undefined ? {} : { pingUrl: target.pingUrl }),
  };
}

/**
 * Reads a failure webhook from a message that failed schema validation.
 * Phase 1 can only deliver through SQS, so other channels are treated as
 * undeliverable and the message is reported for the DLQ.
 */
function readFailureTarget(raw: unknown): CallbackTarget | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const webhooks = raw["webhooks"];
  if (!isRecord(webhooks)) {
    return undefined;
  }

  const failure = webhooks["failure"];
  if (!isRecord(failure)) {
    return undefined;
  }

  const channel = failure["channel"];
  const value = failure["value"];
  if (channel !== "sqs" || typeof value !== "string" || !isSqsQueueArn(value)) {
    return undefined;
  }

  return { channel: "sqs", value };
}

function readRefId(raw: unknown, fallback: string): RefId {
  if (!isRecord(raw)) {
    return fallback;
  }

  const refId = raw["refId"];
  if (typeof refId === "string") {
    return refId;
  }
  if (typeof refId === "number" && Number.isFinite(refId)) {
    return refId;
  }
  if (isRecord(refId)) {
    return refId;
  }

  // The result contract requires a refId; the message id keeps an invalid
  // message correlatable without inventing caller data.
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function log(
  runtime: WorkerRuntime,
  event: string,
  fields: {
    messageId: string;
    printId: string;
    templateId?: string;
    attempt: number;
    errorCode: ErrorCode;
    durationMs: number;
  },
): void {
  runtime.logger.error(event, fields);
}

let coldStartRuntime: WorkerRuntime | undefined;

function runtimeForInvocation(): WorkerRuntime {
  coldStartRuntime ??= composeWorker();
  return coldStartRuntime;
}

// ORCHID-MEM: 01a1c1d8-f1c0-7c6e-8a78-68b1df5d94f4 — Lambda SQS entry point that validates records, processes jobs and reports batch item failures.
export const handler: SqsHandler = createSqsHandler(runtimeForInvocation);
