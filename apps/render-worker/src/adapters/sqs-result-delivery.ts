import { createHash } from "node:crypto";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { SendMessageCommandInput } from "@aws-sdk/client-sqs";
import type { DeliveryContext, PrintResult, RefId, ResultDelivery } from "@printer/domain";
import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";

export type SqsSendClient = {
  send(command: SendMessageCommand): Promise<unknown>;
};

type ParsedQueueArn = {
  readonly partition: string;
  readonly region: string;
  readonly accountId: string;
  readonly queueName: string;
};

const SQS_ARN_PATTERN =
  /^arn:(aws[a-z-]*):sqs:([a-z0-9-]+):([0-9]{12}):([A-Za-z0-9_-]+(?:\.fifo)?)$/;

export function isSqsQueueArn(value: string): boolean {
  return SQS_ARN_PATTERN.test(value);
}

export function parseSqsQueueArn(queueArn: string): ParsedQueueArn {
  const match = SQS_ARN_PATTERN.exec(queueArn);
  if (match === null) {
    throw new Error("invalid SQS queue ARN");
  }

  const [, partition, region, accountId, queueName] = match;
  if (
    partition === undefined ||
    region === undefined ||
    accountId === undefined ||
    queueName === undefined
  ) {
    throw new Error("invalid SQS queue ARN");
  }

  return { partition, region, accountId, queueName };
}

/**
 * Builds the queue URL. By default it uses the ARN's AWS region; when an
 * endpoint (for example LocalStack) is configured, the queue path is appended
 * to that endpoint instead of the AWS host.
 */
export function sqsQueueUrlFromArn(
  queueArn: string,
  region?: string,
  endpointUrl?: string,
): string {
  const parsed = parseSqsQueueArn(queueArn);
  if (endpointUrl !== undefined) {
    return `${endpointUrl.replace(/\/+$/, "")}/${parsed.accountId}/${parsed.queueName}`;
  }

  const dnsSuffix = parsed.partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com";
  return `https://sqs.${region ?? parsed.region}.${dnsSuffix}/${parsed.accountId}/${parsed.queueName}`;
}

export function isFifoQueueArn(queueArn: string): boolean {
  return parseSqsQueueArn(queueArn).queueName.endsWith(".fifo");
}

/**
 * Stable, key-sorted serialization used for FIFO identifiers. Strings and
 * numbers keep their scalar form; objects use canonical JSON.
 */
export function stableSerializeRefId(refId: RefId): string {
  if (typeof refId === "string") {
    return refId;
  }
  if (typeof refId === "number") {
    return String(refId);
  }

  return canonicalJson(refId);
}

export type FifoIdentifiers = {
  readonly messageGroupId: string;
  readonly messageDeduplicationId: string;
};

export function fifoIdentifiers(refId: RefId, messageId: string): FifoIdentifiers {
  const serialized = stableSerializeRefId(refId);
  const messageGroupId =
    typeof refId === "string" && refId.length > 0 && refId.length <= 128
      ? refId
      : sha256Hex(serialized);

  return {
    messageGroupId,
    messageDeduplicationId: sha256Hex(`${serialized}${messageId}`),
  };
}

/**
 * Sends the result to an SQS callback queue. This adapter handles only the
 * `sqs` channel; the composition root routes the other channels separately.
 */
// ORCHID-MEM: 01a1c1d8-f2fd-74ad-98df-82f314ec4228 — Delivers success or failure results to an SQS queue, including FIFO identifiers.
export class SqsResultDelivery implements ResultDelivery {
  constructor(
    private readonly client: SqsSendClient,
    private readonly endpointUrl?: string,
  ) {}

  async deliver(result: PrintResult, context: DeliveryContext): Promise<void> {
    if (context.target.channel !== "sqs") {
      throw new CallbackNotAllowed(`unsupported callback channel: ${context.target.channel}`);
    }

    let queueUrl: string;
    let fifo: boolean;
    try {
      queueUrl = sqsQueueUrlFromArn(context.target.value, undefined, this.endpointUrl);
      fifo = isFifoQueueArn(context.target.value);
    } catch (error) {
      throw new DeliveryFailed("callback target is not a valid SQS queue ARN", { cause: error });
    }

    const input: SendMessageCommandInput = {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(result),
    };

    if (fifo) {
      const identifiers = fifoIdentifiers(context.refId, context.messageId);
      input.MessageGroupId = identifiers.messageGroupId;
      input.MessageDeduplicationId = identifiers.messageDeduplicationId;
    }

    try {
      await this.client.send(new SendMessageCommand(input));
    } catch (error) {
      throw new DeliveryFailed("failed to deliver result to SQS", { cause: error });
    }
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}
