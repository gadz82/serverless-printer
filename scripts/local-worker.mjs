import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { register } from "tsx/esm/api";

const workerRequire = createRequire(new URL("../apps/render-worker/package.json", import.meta.url));
const { DeleteMessageBatchCommand, ReceiveMessageCommand, SQSClient } =
  workerRequire("@aws-sdk/client-sqs");

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const endpoint = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
const region = process.env.AWS_REGION ?? "eu-central-1";

// The worker composition reads its clients from process.env. Set the same
// defaults the documented local flow expects before importing it.
process.env.AWS_ENDPOINT_URL ??= endpoint;
process.env.AWS_ENDPOINT_URL_S3 ??= s3EndpointFor(endpoint);
process.env.AWS_REGION ??= region;
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";
process.env.PRINTS_BUCKET ??= "printer-prints-local";
process.env.SQS_ENDPOINT_URL ??= endpoint;
process.env.TEMPLATE_MANIFEST_PATH ??= path.join(repositoryRoot, "templates.manifest.json");
process.env.MAX_RECEIVE_COUNT ??= "5";
process.env.PRESIGN_TTL_SECONDS ??= "900";

const jobsQueueUrl =
  process.env.JOBS_QUEUE_URL ?? `${endpoint.replace(/\/+$/, "")}/000000000000/printer-jobs`;
const jobsQueueName = queueNameFromUrl(jobsQueueUrl);
const jobsQueueAccount = queueAccountFromUrl(jobsQueueUrl);
const jobsQueueArn = `arn:aws:sqs:${region}:${jobsQueueAccount}:${jobsQueueName}`;
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};
const sqs = new SQSClient({ region, endpoint, credentials, maxAttempts: 3 });

register();
const { createSqsHandler } = await import("../apps/render-worker/src/handler.ts");
const { composeWorker } = await import("../apps/render-worker/src/composition-root.ts");

let runtime;
try {
  runtime = composeWorker(process.env);
} catch (error) {
  console.error(
    `Local worker could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error("Run `pnpm local:setup` before starting the worker.");
  process.exit(1);
}

const handler = createSqsHandler(() => runtime);
const stop = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.log(`Local worker stopping (${signal}).`);
    stop.abort();
  });
}

console.log(`Local worker polling ${jobsQueueUrl}`);
await poll();

async function poll() {
  while (!stop.signal.aborted) {
    let messages;
    try {
      const output = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: jobsQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          AttributeNames: ["All"],
          MessageAttributeNames: ["All"],
        }),
        { abortSignal: stop.signal },
      );
      messages = output.Messages ?? [];
    } catch (error) {
      if (stop.signal.aborted) {
        break;
      }
      console.error(
        JSON.stringify({
          event: "local_receive_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      await delay(2_000);
      continue;
    }

    if (messages.length > 0) {
      await processBatch(messages);
    }
  }
}

async function processBatch(messages) {
  const records = messages.map(toSqsRecord);
  let response;

  try {
    response = await handler({ Records: records });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "local_handler_failed",
        messageIds: records.map((record) => record.messageId),
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }

  const failedIds = new Set(response.batchItemFailures.map((failure) => failure.itemIdentifier));
  const deletable = messages.filter(
    (message) => message.MessageId !== undefined && !failedIds.has(message.MessageId),
  );

  if (deletable.length > 0) {
    await deleteMessages(deletable);
  }

  console.log(
    JSON.stringify({
      event: "local_batch",
      received: messages.length,
      deleted: deletable.length,
      failed: [...failedIds],
    }),
  );
}

async function deleteMessages(messages) {
  const entries = messages.map((message, index) => ({
    Id: `message-${index}`,
    ReceiptHandle: message.ReceiptHandle,
  }));
  const messageIdsByEntry = new Map(
    entries.map((entry, index) => [entry.Id, messages[index]?.MessageId]),
  );

  try {
    const output = await sqs.send(
      new DeleteMessageBatchCommand({ QueueUrl: jobsQueueUrl, Entries: entries }),
    );
    const failures = output.Failed ?? [];
    if (failures.length > 0) {
      console.error(
        JSON.stringify({
          event: "local_delete_failed",
          messageIds: failures.map((failure) => messageIdsByEntry.get(failure.Id)),
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "local_delete_failed",
        messageIds: messages.map((message) => message.MessageId),
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function toSqsRecord(message) {
  const attributes = message.Attributes ?? {};

  return {
    messageId: message.MessageId ?? "",
    receiptHandle: message.ReceiptHandle ?? "",
    body: message.Body ?? "",
    attributes: {
      ApproximateReceiveCount: attributes.ApproximateReceiveCount ?? "1",
      SentTimestamp: attributes.SentTimestamp ?? "0",
      SenderId: attributes.SenderId ?? "unknown",
      ApproximateFirstReceiveTimestamp: attributes.ApproximateFirstReceiveTimestamp ?? "0",
    },
    messageAttributes: {},
    md5OfBody: message.MD5OfBody ?? "",
    eventSource: "aws:sqs",
    eventSourceARN: jobsQueueArn,
    awsRegion: region,
  };
}

function queueNameFromUrl(queueUrl) {
  const segments = new URL(queueUrl).pathname.split("/").filter(Boolean);
  return segments.at(-1) ?? "printer-jobs";
}

function queueAccountFromUrl(queueUrl) {
  const segments = new URL(queueUrl).pathname.split("/").filter(Boolean);
  return segments.at(-2) ?? "000000000000";
}

/**
 * The worker builds `new S3Client({})`, which uses virtual-host bucket routing.
 * LocalStack only serves that style for `<bucket>.s3.localhost.localstack.cloud`,
 * so keep AWS_ENDPOINT_URL for SQS and give S3 its own host.
 */
function s3EndpointFor(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  if (
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1"
  ) {
    parsed.hostname = "s3.localhost.localstack.cloud";
    return parsed.toString().replace(/\/$/, "");
  }

  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
