import { randomBytes } from "node:crypto";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SQSEvent, SQSRecord } from "aws-lambda";

// buildManifest is a plain ESM build script; tests only need its runtime export.
// @ts-expect-error - the script has no TypeScript declaration file.
import { buildManifest } from "../../../scripts/template-manifest.mjs";

// The root package intentionally has no runtime dependencies. Resolve the AWS
// SDK through the worker package so integration tests use the pinned catalog
// version without adding a second dependency declaration.
const workerRequire = createRequire(
  new URL("../../../apps/render-worker/package.json", import.meta.url),
);
const {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ListQueuesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} = workerRequire("@aws-sdk/client-sqs");
const {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} = workerRequire("@aws-sdk/client-s3");

export const LOCALSTACK_ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
export const AWS_REGION = process.env.AWS_REGION ?? "eu-central-1";
export const S3_ENDPOINT = process.env.AWS_ENDPOINT_URL_S3 ?? localS3Endpoint(LOCALSTACK_ENDPOINT);
export const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const CREDENTIALS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
};

export type QueueHandle = {
  readonly name: string;
  readonly url: string;
  readonly arn: string;
};

export type ReceivedMessage = {
  readonly Body?: string;
  readonly MessageId?: string;
  readonly ReceiptHandle?: string;
  readonly MD5OfBody?: string;
  readonly Attributes?: Readonly<Record<string, string>>;
};

export type ManifestRoot = {
  readonly directory: string;
  readonly manifestPath: string;
};

export function uniqueRunId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

/**
 * The worker always builds `new S3Client({})`; LocalStack serves virtual-host
 * bucket routing only on its dedicated S3 hostname.
 */
export function localS3Endpoint(endpoint: string): string {
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    return endpoint;
  }

  if (
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1"
  ) {
    parsed.hostname = "s3.localhost.localstack.cloud";
    return parsed.toString().replace(/\/$/, "");
  }

  return endpoint;
}

export function createSqsClient() {
  return new SQSClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: CREDENTIALS,
    maxAttempts: 1,
  });
}

export function createS3Client() {
  return new S3Client({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: CREDENTIALS,
    forcePathStyle: true,
    maxAttempts: 1,
  });
}

export async function assertLocalStackReachable(
  sqs: ReturnType<typeof createSqsClient>,
): Promise<void> {
  try {
    await sqs.send(new ListQueuesCommand({ MaxResults: 1 }));
  } catch (error) {
    throw new Error(
      `LocalStack is not reachable at ${LOCALSTACK_ENDPOINT}. ` +
        'Start it with "docker compose up -d localstack", or set AWS_ENDPOINT_URL to a running LocalStack.',
      { cause: error },
    );
  }
}

export async function createQueue(
  sqs: ReturnType<typeof createSqsClient>,
  name: string,
  attributes: Record<string, string> = {},
): Promise<QueueHandle> {
  const created = await sqs.send(
    new CreateQueueCommand({ QueueName: name, Attributes: attributes }),
  );
  const url = created.QueueUrl;

  if (url === undefined) {
    throw new Error(`LocalStack did not return a URL for queue ${name}`);
  }

  const output = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }),
  );
  const arn = output.Attributes?.QueueArn;

  if (arn === undefined) {
    throw new Error(`LocalStack did not return an ARN for queue ${name}`);
  }

  return { name, url, arn };
}

export async function deleteQueue(
  sqs: ReturnType<typeof createSqsClient>,
  queue: QueueHandle,
): Promise<void> {
  await sqs.send(new DeleteQueueCommand({ QueueUrl: queue.url }));
}

export async function createBucket(
  s3: ReturnType<typeof createS3Client>,
  name: string,
): Promise<void> {
  const input: {
    Bucket: string;
    CreateBucketConfiguration?: { LocationConstraint: string };
  } = { Bucket: name };
  if (AWS_REGION !== "us-east-1") {
    input.CreateBucketConfiguration = { LocationConstraint: AWS_REGION };
  }
  await s3.send(new CreateBucketCommand(input));
}

export async function deleteBucket(
  s3: ReturnType<typeof createS3Client>,
  name: string,
): Promise<void> {
  let continuationToken: string | undefined;

  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: name, ContinuationToken: continuationToken }),
    );
    const contents = (listed.Contents ?? []) as ReadonlyArray<{ Key?: string }>;
    const keys = contents
      .map((entry) => entry.Key)
      .filter((key): key is string => typeof key === "string");

    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: name,
          Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
        }),
      );
    }

    continuationToken = listed.IsTruncated === true ? listed.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);

  await s3.send(new DeleteBucketCommand({ Bucket: name }));
}

export async function createManifestRoot(release: string): Promise<ManifestRoot> {
  const directory = await mkdtemp(path.join(tmpdir(), "printer-integration-"));
  await symlink(path.join(REPOSITORY_ROOT, "templates"), path.join(directory, "templates"), "dir");
  await buildManifest(directory, release);
  return { directory, manifestPath: path.join(directory, "templates.manifest.json") };
}

export async function removeManifestRoot(root: ManifestRoot | undefined): Promise<void> {
  if (root === undefined) {
    return;
  }
  await rm(root.directory, { recursive: true, force: true });
}

export async function sendMessage(
  sqs: ReturnType<typeof createSqsClient>,
  queueUrl: string,
  body: string,
): Promise<void> {
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
}

export async function receiveMessages(
  sqs: ReturnType<typeof createSqsClient>,
  queueUrl: string,
  waitTimeSeconds = 1,
): Promise<readonly ReceivedMessage[]> {
  const output = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: waitTimeSeconds,
      AttributeNames: ["All"],
      MessageAttributeNames: ["All"],
    }),
  );

  return output.Messages ?? [];
}

export async function waitForMessage(
  sqs: ReturnType<typeof createSqsClient>,
  queueUrl: string,
  predicate: (message: ReceivedMessage) => boolean,
  timeoutMilliseconds = 15_000,
): Promise<ReceivedMessage | undefined> {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const remainingSeconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1_000));
    const messages = await receiveMessages(sqs, queueUrl, Math.min(remainingSeconds, 5));
    const match = messages.find(predicate);
    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

export async function deleteMessage(
  sqs: ReturnType<typeof createSqsClient>,
  queueUrl: string,
  message: ReceivedMessage,
): Promise<void> {
  if (message.ReceiptHandle === undefined) {
    return;
  }
  await sqs.send(
    new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
  );
}

export async function readObject(
  s3: ReturnType<typeof createS3Client>,
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const output = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = output.Body;

  if (body === undefined || typeof body.transformToByteArray !== "function") {
    throw new Error(`S3 object ${bucket}/${key} has no readable body`);
  }

  return body.transformToByteArray();
}

export function toSqsEvent(
  messages: readonly ReceivedMessage[],
  queueArn: string,
  receiveCount?: number,
): SQSEvent {
  return { Records: messages.map((message) => toSqsRecord(message, queueArn, receiveCount)) };
}

function toSqsRecord(message: ReceivedMessage, queueArn: string, receiveCount?: number): SQSRecord {
  const attributes = message.Attributes ?? {};

  return {
    messageId: message.MessageId ?? "",
    receiptHandle: message.ReceiptHandle ?? "",
    body: message.Body ?? "",
    attributes: {
      ApproximateReceiveCount:
        receiveCount === undefined
          ? (attributes.ApproximateReceiveCount ?? "1")
          : String(receiveCount),
      SentTimestamp: attributes.SentTimestamp ?? "0",
      SenderId: attributes.SenderId ?? "unknown",
      ApproximateFirstReceiveTimestamp: attributes.ApproximateFirstReceiveTimestamp ?? "0",
    },
    messageAttributes: {},
    md5OfBody: message.MD5OfBody ?? "",
    eventSource: "aws:sqs",
    eventSourceARN: queueArn,
    awsRegion: AWS_REGION,
  };
}
