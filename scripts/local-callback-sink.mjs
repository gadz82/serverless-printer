import { appendFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRequire = createRequire(new URL("../apps/render-worker/package.json", import.meta.url));
const { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } =
  workerRequire("@aws-sdk/client-sqs");

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const resultsPath = path.join(repositoryRoot, ".local", "results.jsonl");
const endpoint = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
const region = process.env.AWS_REGION ?? "eu-central-1";
const queueUrl =
  process.env.SMOKE_QUEUE_URL ??
  `${endpoint.replace(/\/+$/, "")}/000000000000/printer-smoke-results`;
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
};

const sqs = new SQSClient({ region, endpoint, credentials, maxAttempts: 3 });
const stop = new AbortController();

await mkdir(path.dirname(resultsPath), { recursive: true });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.log(`Callback sink stopping (${signal}).`);
    stop.abort();
  });
}

console.log(`Callback sink recording ${queueUrl} results to ${resultsPath}`);
await poll();

async function poll() {
  while (!stop.signal.aborted) {
    let messages;
    try {
      const output = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
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
          event: "local_sink_receive_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      await delay(2_000);
      continue;
    }

    for (const message of messages) {
      await record(message);
    }
  }
}

/**
 * The local recorder is at-least-once: the message is deleted only after a
 * valid JSON line is appended. A failed append or delete leaves/returns the
 * message for redelivery, so duplicate lines are possible.
 */
async function record(message) {
  const result = parseResult(message.Body ?? "");

  if (result === undefined) {
    console.warn(`discarded invalid callback message ${message.MessageId ?? "unknown"}`);
    // Poison messages are dropped only in this local recorder; the callback
    // queue is not a source of truth.
    await removeMessage(message);
    return;
  }

  try {
    await appendFile(resultsPath, `${JSON.stringify(result)}\n`, "utf8");
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "local_sink_append_failed",
        messageId: message.MessageId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }

  await removeMessage(message);
  console.log(
    `recorded ${result.printId ?? "unknown"} success=${String(result.success ?? "unknown")}`,
  );
}

async function removeMessage(message) {
  try {
    await sqs.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "local_sink_delete_failed",
        messageId: message.MessageId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function parseResult(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
