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

const TIMEOUT_MILLISECONDS = 180_000;
const MAX_POLL_WAIT_SECONDS = 20;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SMOKE_SCENARIOS = [
  { name: "plain", pdfA: false, message: "Printer smoke" },
  { name: "pdfa-2b", pdfA: "PDF/A-2b", message: "Printer smoke PDF/A-2b" },
];

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

// ORCHID-MEM: 01a1c6e2-74e6-7a60-b670-ffe141c7f55d — Sends plain and PDF/A smoke jobs and validates both callback results.
async function run(client, config) {
  const jobs = SMOKE_SCENARIOS.map((scenario) => ({
    scenario,
    refId: `smoke-${scenario.name}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  }));

  for (const job of jobs) {
    const body = {
      templateId: "_smoke",
      refId: job.refId,
      webhooks: {
        success: { channel: "sqs", value: config.smokeQueueArn },
        failure: { channel: "sqs", value: config.smokeQueueArn },
      },
      options: { pdfA: job.scenario.pdfA },
      payload: { message: job.scenario.message },
    };
    if (!validateJob(body)) {
      throw new Error(
        `Smoke ${job.scenario.name} job does not satisfy @printer/contracts: ${formatValidationErrors(validateJob.errors)}`,
      );
    }

    console.log(`Sending _smoke ${job.scenario.name} job ${job.refId} to ${config.jobsQueueUrl}`);
    await client.send(
      new SendMessageCommand({
        QueueUrl: config.jobsQueueUrl,
        MessageBody: JSON.stringify(body),
      }),
    );
  }

  console.log(
    `Waiting up to ${TIMEOUT_MILLISECONDS / 1_000}s for both smoke results on ${config.smokeQueueUrl}`,
  );
  const { results, missing } = await waitForResults(client, config, jobs);

  if (missing.length > 0) {
    await deleteResults(client, config, results);
    throw new Error(
      `Timed out after ${TIMEOUT_MILLISECONDS / 1_000}s waiting for ${missing
        .map((job) => `${job.scenario.name} (${job.refId})`)
        .join(", ")}. Check the worker logs and the smoke-results queue.`,
    );
  }

  try {
    for (const job of jobs) {
      const received = results.get(job.refId);
      if (received === undefined) {
        throw new Error(`No smoke result was recorded for ${job.refId}.`);
      }

      assertSmokeResult(received.result, config.release, job.scenario);
      console.log(
        `Smoke ${job.scenario.name} OK: template=${received.result.template.slug}@${received.result.template.release} ` +
          `pdfA=${String(received.result.pdfA)} sizeBytes=${received.result.sizeBytes} sha256=${received.result.sha256}`,
      );
    }
  } finally {
    await deleteResults(client, config, results);
  }
}

async function deleteResults(client, config, results) {
  for (const [refId, received] of results) {
    try {
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: config.smokeQueueUrl,
          ReceiptHandle: received.receiptHandle,
        }),
      );
    } catch (error) {
      console.warn(
        `Could not delete smoke result ${refId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function waitForResults(client, config, jobs) {
  const byRefId = new Map(jobs.map((job) => [job.refId, job]));
  const pending = new Set(byRefId.keys());
  const results = new Map();
  const deadline = Date.now() + TIMEOUT_MILLISECONDS;

  while (Date.now() < deadline && pending.size > 0) {
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
      if (result === undefined || !pending.has(result.refId)) {
        continue;
      }
      if (message.ReceiptHandle === undefined) {
        throw new Error(
          `SQS returned message ${message.MessageId ?? "unknown"} without a receipt handle.`,
        );
      }

      results.set(result.refId, { result, receiptHandle: message.ReceiptHandle });
      pending.delete(result.refId);
    }
  }

  return { results, missing: [...pending].map((refId) => byRefId.get(refId)) };
}

function assertSmokeResult(result, expectedRelease, scenario) {
  if (!validateResult(result)) {
    throw new Error(
      `Smoke result does not satisfy @printer/contracts: ${formatValidationErrors(
        validateResult.errors,
      )}`,
    );
  }

  if (result.success !== true) {
    const hint =
      result.error.code === "PDFA_LEVEL_NOT_ALLOWED"
        ? " Ensure infra pdfa_allowed_levels includes PDF/A-2b for the release smoke."
        : "";
    throw new Error(
      `Smoke ${scenario.name} job failed (${result.error.code}): ${result.error.message}.${hint}`,
    );
  }

  if (result.template.slug !== "_smoke") {
    throw new Error(`Smoke result resolved template "${result.template.slug}", expected "_smoke".`);
  }

  if (result.template.release !== expectedRelease) {
    throw new Error(
      `Smoke result reports template release "${result.template.release}", expected "${expectedRelease}".`,
    );
  }

  const expectedPdfA = scenario.pdfA === false ? null : scenario.pdfA;
  if (result.pdfA !== expectedPdfA) {
    throw new Error(
      `Smoke ${scenario.name} result reports pdfA ${JSON.stringify(result.pdfA)}, expected ${JSON.stringify(expectedPdfA)}.`,
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
