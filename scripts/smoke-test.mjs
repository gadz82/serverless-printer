import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { register } from "tsx/esm/api";

const workerRequire = createRequire(new URL("../apps/render-worker/package.json", import.meta.url));
const { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } =
  workerRequire("@aws-sdk/client-sqs");

register();

// The contracts package ships TypeScript sources, so load its entry through
// tsx rather than depending on a build step that does not exist at release time.
const contractsRequire = createRequire(
  new URL("../packages/contracts/package.json", import.meta.url),
);
const contractsEntry = contractsRequire.resolve("./src/index.ts");
const { formatValidationErrors, validateJob, validateResult } = await import(
  pathToFileURL(contractsEntry).href
);

const TIMEOUT_MILLISECONDS = 60_000;
const MAX_POLL_WAIT_SECONDS = 20;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

let sqs;

try {
  const config = readConfig();
  sqs = new SQSClient({ region: config.region });
  await run(sqs, config);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  sqs?.destroy();
}

async function run(client, config) {
  const refId = `smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const job = {
    templateId: "_smoke",
    refId,
    webhooks: {
      success: { channel: "sqs", value: config.smokeQueueArn },
    },
    payload: { message: "Printer smoke" },
  };

  if (!validateJob(job)) {
    throw new Error(
      `Smoke job does not satisfy @printer/contracts: ${formatValidationErrors(validateJob.errors)}`,
    );
  }

  console.log(`Sending _smoke job ${refId} to ${config.jobsQueueUrl}`);
  await client.send(
    new SendMessageCommand({
      QueueUrl: config.jobsQueueUrl,
      MessageBody: JSON.stringify(job),
    }),
  );

  console.log(
    `Waiting up to ${TIMEOUT_MILLISECONDS / 1_000}s for ${refId} on ${config.smokeQueueUrl}`,
  );
  const received = await waitForResult(client, config, refId);

  if (received === undefined) {
    throw new Error(
      `Timed out after ${TIMEOUT_MILLISECONDS / 1_000}s waiting for ${refId}. ` +
        "Check the worker logs and the smoke-results queue.",
    );
  }

  try {
    assertSmokeResult(received.result, config.release);
  } finally {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: config.smokeQueueUrl,
        ReceiptHandle: received.receiptHandle,
      }),
    );
  }

  console.log(
    `Smoke result OK: template=${received.result.template.slug}@${received.result.template.release} ` +
      `sizeBytes=${received.result.sizeBytes} sha256=${received.result.sha256}`,
  );
}

async function waitForResult(client, config, expectedRefId) {
  const deadline = Date.now() + TIMEOUT_MILLISECONDS;

  while (Date.now() < deadline) {
    const remainingSeconds = Math.max(0, Math.floor((deadline - Date.now()) / 1_000));
    const waitTimeSeconds = Math.min(MAX_POLL_WAIT_SECONDS, remainingSeconds);
    const output = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: config.smokeQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: waitTimeSeconds,
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      }),
    );

    for (const message of output.Messages ?? []) {
      const result = parseResult(message.Body);
      if (result !== undefined && result.refId === expectedRefId) {
        if (message.ReceiptHandle === undefined) {
          throw new Error(
            `SQS returned message ${message.MessageId ?? "unknown"} without a receipt handle.`,
          );
        }

        return { result, receiptHandle: message.ReceiptHandle };
      }
    }
  }

  return undefined;
}

function assertSmokeResult(result, expectedRelease) {
  if (!validateResult(result)) {
    throw new Error(
      `Smoke result does not satisfy @printer/contracts: ${formatValidationErrors(
        validateResult.errors,
      )}`,
    );
  }

  if (result.success !== true) {
    throw new Error(`Smoke job failed (${result.error.code}): ${result.error.message}`);
  }

  if (result.template.slug !== "_smoke") {
    throw new Error(`Smoke result resolved template "${result.template.slug}", expected "_smoke".`);
  }

  if (result.template.release !== expectedRelease) {
    throw new Error(
      `Smoke result reports template release "${result.template.release}", expected "${expectedRelease}".`,
    );
  }

  if (typeof result.sha256 !== "string" || !SHA256_PATTERN.test(result.sha256)) {
    throw new Error("Smoke result is missing a lower-case SHA-256 digest.");
  }

  if (!Number.isSafeInteger(result.sizeBytes) || result.sizeBytes < 1) {
    throw new Error("Smoke result is missing a positive sizeBytes value.");
  }
}

function parseResult(body) {
  if (typeof body !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readConfig() {
  const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
  if (region === undefined || region.length === 0) {
    throw new Error("AWS_REGION (or AWS_DEFAULT_REGION) is required.");
  }

  return {
    region,
    release: requiredEnv("RELEASE"),
    jobsQueueUrl: requiredEnv("JOBS_QUEUE_URL"),
    smokeQueueUrl: requiredEnv("SMOKE_QUEUE_URL"),
    smokeQueueArn: requiredEnv("SMOKE_QUEUE_ARN"),
  };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
