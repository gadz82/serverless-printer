import { createHash } from "node:crypto";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";
import type { DeliveryContext, PrintResult } from "@printer/domain";
import {
  SqsResultDelivery,
  fifoIdentifiers,
  isFifoQueueArn,
  isSqsQueueArn,
  parseSqsQueueArn,
  sqsQueueUrlFromArn,
  stableSerializeRefId,
  type SqsSendClient,
} from "../src/adapters/sqs-result-delivery.js";

const STANDARD_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-results";
const FIFO_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-results.fifo";

class RecordingSqsClient implements SqsSendClient {
  readonly commands: SendMessageCommand[] = [];

  constructor(private readonly failure?: Error) {}

  async send(command: SendMessageCommand): Promise<unknown> {
    this.commands.push(command);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return { MessageId: "outbound-1" };
  }
}

const result: PrintResult = {
  success: true,
  printId: "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c",
  refId: "invoice-1",
  printing: "https://prints.example.com/prints/print.pdf?X-Amz-Signature=abc",
  printingExpiresAt: "2026-11-09T10:15:00.000Z",
  sha256: "b".repeat(64),
  sizeBytes: 5,
  pdfA: null,
  template: {
    id: "72803074-1601-4a08-a5a5-49db9feacd66",
    slug: "_smoke",
    contentHash: "c".repeat(64),
    release: "local",
  },
  renderedAt: "2026-11-09T10:00:00.000Z",
};

function context(queueArn: string, refId: DeliveryContext["refId"] = "invoice-1"): DeliveryContext {
  return {
    target: { channel: "sqs", value: queueArn },
    refId,
    messageId: "message-1",
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("SQS queue ARN conversion", () => {
  it("builds the HTTPS queue URL from the ARN", () => {
    expect(sqsQueueUrlFromArn(STANDARD_ARN)).toBe(
      "https://sqs.eu-central-1.amazonaws.com/123456789012/printer-results",
    );
    expect(sqsQueueUrlFromArn(FIFO_ARN)).toBe(
      "https://sqs.eu-central-1.amazonaws.com/123456789012/printer-results.fifo",
    );
    expect(sqsQueueUrlFromArn("arn:aws-cn:sqs:cn-north-1:123456789012:jobs")).toBe(
      "https://sqs.cn-north-1.amazonaws.com.cn/123456789012/jobs",
    );
  });

  it("uses a configured endpoint instead of the AWS host", () => {
    expect(sqsQueueUrlFromArn(STANDARD_ARN, undefined, "http://localhost:4566")).toBe(
      "http://localhost:4566/123456789012/printer-results",
    );
    expect(sqsQueueUrlFromArn(FIFO_ARN, undefined, "http://localhost:4566///")).toBe(
      "http://localhost:4566/123456789012/printer-results.fifo",
    );
  });

  it("accepts only SQS ARNs", () => {
    expect(isSqsQueueArn(STANDARD_ARN)).toBe(true);
    expect(isSqsQueueArn("arn:aws:lambda:eu-central-1:123456789012:function:printer")).toBe(false);
    expect(() => parseSqsQueueArn("not-an-arn")).toThrow(/invalid SQS queue ARN/);
    expect(isFifoQueueArn(FIFO_ARN)).toBe(true);
    expect(isFifoQueueArn(STANDARD_ARN)).toBe(false);
  });
});

describe("SqsResultDelivery", () => {
  it("sends the JSON result to a standard queue without FIFO attributes", async () => {
    const client = new RecordingSqsClient();
    const delivery = new SqsResultDelivery(client);

    await delivery.deliver(result, context(STANDARD_ARN));

    expect(client.commands).toHaveLength(1);
    expect(client.commands[0]?.input).toEqual({
      QueueUrl: "https://sqs.eu-central-1.amazonaws.com/123456789012/printer-results",
      MessageBody: JSON.stringify(result),
    });
  });

  it("uses the configured endpoint for the queue URL", async () => {
    const client = new RecordingSqsClient();
    const delivery = new SqsResultDelivery(client, "http://localhost:4566/");

    await delivery.deliver(result, context(FIFO_ARN));

    expect(client.commands[0]?.input.QueueUrl).toBe(
      "http://localhost:4566/123456789012/printer-results.fifo",
    );
  });

  it("uses the refId as MessageGroupId for a short FIFO refId", async () => {
    const client = new RecordingSqsClient();
    const delivery = new SqsResultDelivery(client);

    await delivery.deliver(result, context(FIFO_ARN, "invoice-1"));

    expect(client.commands[0]?.input).toEqual({
      QueueUrl: "https://sqs.eu-central-1.amazonaws.com/123456789012/printer-results.fifo",
      MessageBody: JSON.stringify(result),
      MessageGroupId: "invoice-1",
      MessageDeduplicationId: sha256("invoice-1message-1"),
    });
  });

  it("hashes a long FIFO refId and always hashes the deduplication id", async () => {
    const longRefId = "a".repeat(129);
    const client = new RecordingSqsClient();
    const delivery = new SqsResultDelivery(client);

    await delivery.deliver(result, context(FIFO_ARN, longRefId));

    expect(client.commands[0]?.input).toMatchObject({
      MessageGroupId: sha256(longRefId),
      MessageDeduplicationId: sha256(`${longRefId}message-1`),
    });
  });

  it("canonicalizes object refIds so key order does not change the identifiers", () => {
    const left = fifoIdentifiers({ b: 2, a: 1 }, "message-1");
    const right = fifoIdentifiers({ a: 1, b: 2 }, "message-1");
    const canonical = '{"a":1,"b":2}';

    expect(left).toEqual(right);
    expect(left).toEqual({
      messageGroupId: sha256(canonical),
      messageDeduplicationId: sha256(`${canonical}message-1`),
    });
    expect(stableSerializeRefId({ nested: { z: 1, a: 2 } })).toBe('{"nested":{"a":2,"z":1}}');
  });

  it("hashes numeric refIds for the group id", () => {
    expect(fifoIdentifiers(42, "message-1")).toEqual({
      messageGroupId: sha256("42"),
      messageDeduplicationId: sha256("42message-1"),
    });
  });

  it("rejects a non-SQS channel with CALLBACK_NOT_ALLOWED", async () => {
    const delivery = new SqsResultDelivery(new RecordingSqsClient());

    await expect(
      delivery.deliver(result, {
        target: { channel: "http", value: "https://callbacks.example.com/print" },
        refId: "invoice-1",
        messageId: "message-1",
      }),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
  });

  it("wraps SDK failures in the retryable DELIVERY_FAILED error", async () => {
    const cause = new Error("sqs unavailable");
    const delivery = new SqsResultDelivery(new RecordingSqsClient(cause));

    await expect(delivery.deliver(result, context(STANDARD_ARN))).rejects.toMatchObject({
      name: "DeliveryFailed",
      retryable: true,
      cause,
    });
  });

  it("wraps an invalid queue ARN in DELIVERY_FAILED", async () => {
    const delivery = new SqsResultDelivery(new RecordingSqsClient());

    await expect(delivery.deliver(result, context("not-an-arn"))).rejects.toBeInstanceOf(
      DeliveryFailed,
    );
  });
});
