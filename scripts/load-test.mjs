import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { register } from "tsx/esm/api";

const workerRequire = createRequire(new URL("../apps/render-worker/package.json", import.meta.url));
const { DeleteMessageCommand, ReceiveMessageCommand, SendMessageBatchCommand, SQSClient } =
  workerRequire("@aws-sdk/client-sqs");

register();

const contractsRequire = createRequire(
  new URL("../packages/contracts/package.json", import.meta.url),
);
const contractsEntry = contractsRequire.resolve("./src/index.ts");
const { formatValidationErrors, validateJob, validateResult } = await import(
  pathToFileURL(contractsEntry).href
);

const DEFAULT_JOB_COUNT = 20;
const DEFAULT_TIMEOUT_SECONDS = 240;
const MAX_POLL_WAIT_SECONDS = 20;
const MAX_JOBS = 200;
const TWENTY_PAGE_ITEMS = 450;
const TARGET_JOBS_PER_MINUTE = 10;
const TARGET_P95_MILLISECONDS = 30_000;
const GENERATED_AT = "2026-11-01T09:30:00.000Z";
const SCENARIOS = [
  { id: "1-page-plain", pages: 1, pdfA: false },
  { id: "1-page-pdfa", pages: 1, pdfA: "PDF/A-2b" },
  { id: "20-page-plain", pages: 20, pdfA: false },
  { id: "20-page-pdfa", pages: 20, pdfA: "PDF/A-2b" },
];
const USAGE = [
  "Usage: node scripts/load-test.mjs [--print-event <scenario>] [--help]",
  "",
  "Sends LOAD_TEST_JOBS (default 20) generic-report jobs to the deployed queue and reports",
  "throughput, latency, errors and Lambda memory. Scenarios cycle through",
  "1-page-plain, 1-page-pdfa, 20-page-plain and 20-page-pdfa.",
  "",
  "Environment:",
  "  AWS_REGION                 required (AWS_DEFAULT_REGION is also accepted)",
  "  JOBS_QUEUE_URL             required",
  "  CALLBACK_QUEUE_URL         required",
  "  CALLBACK_QUEUE_ARN         required (also for --print-event)",
  "  MAX_RECEIVE_COUNT          optional, default 5; used in --print-event",
  "  LOAD_TEST_JOBS             optional, default 20 (max 200)",
  "  LOAD_TEST_TIMEOUT_SECONDS  optional, default 240",
  "  LOAD_TEST_ENFORCE_TARGET   optional: fail below 10 jobs/min or p95 >= 30 s",
  "  WORKER_LOG_GROUP           optional: enables Max Memory Used from CloudWatch Logs",
  "",
  "  --print-event <scenario>   print an SQS event for Lambda Power Tuning and exit",
  "                             (1-page-plain, 1-page-pdfa, 20-page-plain, 20-page-pdfa)",
].join("\n");

let sqs;

try {
  const options = parseLoadTestArguments(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
  } else if (options.printEvent !== undefined) {
    printPowerTuningEvent(options.printEvent);
  } else {
    const config = readConfig();
    sqs = new SQSClient({ region: config.region });
    await run(sqs, config);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  sqs?.destroy();
}

/**
 * @param {readonly string[]} argv
 * @returns {{ help: boolean, printEvent?: string }}
 */
function parseLoadTestArguments(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        "print-event": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: false,
    });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }

  const printEvent = parsed.values["print-event"];
  if (printEvent !== undefined && !SCENARIOS.some((scenario) => scenario.id === printEvent)) {
    throw new Error(
      `Unknown scenario "${printEvent}". Expected one of: ${SCENARIOS.map((scenario) => scenario.id).join(", ")}.`,
    );
  }

  return { help: parsed.values.help === true, printEvent };
}

async function run(client, config) {
  const jobs = buildJobs(config);
  const startedAt = Date.now();
  const sendFailures = [];

  console.log(
    `Load test: ${String(jobs.length)} jobs to ${config.jobsQueueUrl} ` +
      `(${describeMatrix(jobs)}), timeout ${String(config.timeoutSeconds)}s`,
  );

  for (const chunk of batchJobs(jobs)) {
    let output;
    try {
      output = await client.send(
        new SendMessageBatchCommand({
          QueueUrl: config.jobsQueueUrl,
          Entries: chunk.map((job) => ({
            Id: `m${String(job.index)}`,
            MessageBody: JSON.stringify(job.body),
          })),
        }),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const job of chunk) {
        sendFailures.push({ job, reason });
      }
      continue;
    }

    const failed = new Map((output.Failed ?? []).map((failure) => [failure.Id, failure]));
    const sentAt = Date.now();
    for (const job of chunk) {
      const failure = failed.get(`m${String(job.index)}`);
      if (failure !== undefined) {
        sendFailures.push({ job, reason: failure.Code ?? "SQS rejected the message" });
      } else {
        job.sentAt = sentAt;
      }
    }
  }

  const sentJobs = jobs.filter((job) => job.sentAt > 0);
  const { results, missing } = await waitForResults(client, config, sentJobs);
  const completed = [...results.values()];
  const latencies = completed.map((entry) => entry.receivedAt - entry.job.sentAt);
  const lastReceivedAt =
    completed.length > 0 ? Math.max(...completed.map((entry) => entry.receivedAt)) : Date.now();
  const elapsedMinutes = Math.max((lastReceivedAt - startedAt) / 60_000, 1 / 60_000);
  const throughput = completed.length / elapsedMinutes;
  const twentyPage = completed.filter((entry) => entry.job.scenario.pages === 20);
  const twentyPageLatencies = twentyPage.map((entry) => entry.receivedAt - entry.job.sentAt);
  const twentyPageThroughput = twentyPage.length / elapsedMinutes;
  const memory = collectMemory(config, startedAt, lastReceivedAt + 60_000);
  const resultFailures = completed.filter(
    (entry) => !validateResult(entry.result) || entry.result.success !== true,
  );
  const errorCount = sendFailures.length + resultFailures.length + missing.length;

  console.log(
    `Completed: ${String(completed.length)}/${String(sentJobs.length)} ` +
      `(sent ${String(sentJobs.length)}/${String(jobs.length)})`,
  );
  console.log(`Throughput: ${throughput.toFixed(1)} jobs/min (mixed scenarios)`);
  console.log(
    `20-page throughput: ${twentyPageThroughput.toFixed(1)} jobs/min, ` +
      `latency p95=${String(percentile(twentyPageLatencies, 95))} ms, ` +
      `samples=${String(twentyPage.length)}`,
  );
  console.log(
    `Latency ms: p50=${String(percentile(latencies, 50))} p95=${String(
      percentile(latencies, 95),
    )} max=${String(maxOf(latencies))}`,
  );
  if (memory.available) {
    console.log(
      `Memory MB (Max Memory Used): p50=${String(percentile(memory.values, 50))} ` +
        `p95=${String(percentile(memory.values, 95))} max=${String(maxOf(memory.values))}`,
    );
  } else {
    console.log(`Memory: not collected (${memory.reason})`);
  }
  console.log(
    `Errors: ${String(errorCount)}` +
      (resultFailures.length > 0 ? ` (${describeFailures(resultFailures)})` : ""),
  );
  if (sendFailures.length > 0) {
    console.log(
      `Send failures: ${sendFailures
        .map((entry) => `${entry.job.refId}: ${entry.reason}`)
        .join(", ")}`,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `Timed out after ${String(config.timeoutSeconds)}s waiting for ${missing
        .map((job) => `${job.scenario.id} (${job.refId})`)
        .join(", ")}.`,
    );
  }

  if (errorCount > 0) {
    process.exitCode = 1;
  }

  if (config.enforceTarget) {
    assertTarget(twentyPageThroughput, percentile(twentyPageLatencies, 95), errorCount);
  }
}

function buildJobs(config) {
  return Array.from({ length: config.jobCount }, (_, index) => {
    const scenario = SCENARIOS[index % SCENARIOS.length];
    const refId = `load-${String(index + 1)}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const body = {
      templateId: "generic-report",
      refId,
      webhooks: {
        success: { channel: "sqs", value: config.callbackQueueArn },
        failure: { channel: "sqs", value: config.callbackQueueArn },
      },
      options: { pdfA: scenario.pdfA },
      payload: buildPayload(scenario, index),
    };

    if (!validateJob(body)) {
      throw new Error(
        `Generated ${scenario.id} job ${refId} does not satisfy @printer/contracts: ${formatValidationErrors(
          validateJob.errors,
        )}`,
      );
    }

    return { index, scenario, refId, body, sentAt: 0 };
  });
}

function buildPayload(scenario, index) {
  const itemCount = scenario.pages === 1 ? 3 : TWENTY_PAGE_ITEMS;
  return {
    title: `Load test ${scenario.id} job ${String(index + 1)}`,
    customer: { name: `Load test customer ${String(index + 1)}` },
    items: Array.from({ length: itemCount }, (_, itemIndex) => ({
      description: `Consulting line ${String(itemIndex + 1)}`,
      quantity: 1,
      unitPrice: 100,
      amount: 100,
    })),
    total: itemCount * 100,
    generatedAt: GENERATED_AT,
  };
}

function batchJobs(jobs) {
  // SQS caps a batch at 10 messages and 256 KB total. The 20-page payload is
  // large, so group by both count and serialized size with headroom.
  const batches = [];
  let current = [];
  let currentBytes = 0;

  for (const job of jobs) {
    const bytes = Buffer.byteLength(JSON.stringify(job.body), "utf8");
    if (bytes > 240 * 1024) {
      throw new Error(`Load-test job ${job.refId} is ${String(bytes)} bytes; SQS allows 256 KB.`);
    }
    if (current.length === 10 || currentBytes + bytes > 200 * 1024) {
      if (current.length > 0) {
        batches.push(current);
      }
      current = [];
      currentBytes = 0;
    }
    current.push(job);
    currentBytes += bytes;
  }

  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

async function waitForResults(client, config, jobs) {
  const pending = new Map(jobs.map((job) => [job.refId, job]));
  const results = new Map();
  const deadline = Date.now() + config.timeoutSeconds * 1_000;

  while (Date.now() < deadline && pending.size > 0) {
    const remainingSeconds = Math.max(0, Math.floor((deadline - Date.now()) / 1_000));
    const waitTimeSeconds = Math.min(MAX_POLL_WAIT_SECONDS, remainingSeconds);
    const output = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: config.callbackQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: waitTimeSeconds,
        AttributeNames: ["All"],
        MessageAttributeNames: ["All"],
      }),
    );

    for (const message of output.Messages ?? []) {
      const result = parseResult(message.Body);
      if (result === undefined || typeof result.refId !== "string") {
        continue;
      }
      const job = pending.get(result.refId);
      if (job === undefined) {
        continue;
      }
      if (message.ReceiptHandle === undefined) {
        throw new Error(
          `SQS returned message ${message.MessageId ?? "unknown"} without a receipt handle.`,
        );
      }

      results.set(result.refId, { job, result, receivedAt: Date.now() });
      pending.delete(result.refId);
      await deleteMessage(client, config, message.ReceiptHandle);
    }
  }

  return { results, missing: [...pending.values()] };
}

async function deleteMessage(client, config, receiptHandle) {
  try {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: config.callbackQueueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  } catch (error) {
    console.warn(
      `Could not delete a load-test result: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function collectMemory(config, startTime, endTime) {
  if (config.workerLogGroup === undefined) {
    return { available: false, reason: "set WORKER_LOG_GROUP to collect Max Memory Used" };
  }

  const output = spawnSync(
    "aws",
    [
      "logs",
      "filter-log-events",
      "--log-group-name",
      config.workerLogGroup,
      "--start-time",
      String(startTime - 60_000),
      "--end-time",
      String(endTime),
      "--filter-pattern",
      "REPORT RequestId",
      "--output",
      "json",
    ],
    { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );

  if (output.error !== undefined) {
    return { available: false, reason: `aws CLI unavailable: ${output.error.message}` };
  }
  if (output.status !== 0) {
    return {
      available: false,
      reason: `aws logs failed: ${output.stderr.trim().split("\n").at(-1) ?? "unknown error"}`,
    };
  }

  let events;
  try {
    events = JSON.parse(output.stdout).events ?? [];
  } catch {
    return { available: false, reason: "aws logs returned invalid JSON" };
  }

  const values = [];
  for (const event of events) {
    const match = /Max Memory Used:\s*(\d+)\s*MB/.exec(
      typeof event.message === "string" ? event.message : "",
    );
    if (match !== null) {
      values.push(Number(match[1]));
    }
  }

  return values.length > 0
    ? { available: true, values }
    : { available: false, reason: "no Lambda REPORT lines in the load-test window" };
}

function printPowerTuningEvent(scenarioId) {
  const scenario = SCENARIOS.find((candidate) => candidate.id === scenarioId);
  if (scenario === undefined) {
    throw new Error(`Unknown scenario "${scenarioId}".`);
  }

  const region = process.env.AWS_REGION?.trim() || "eu-central-1";
  const callbackArn = requiredEnv("CALLBACK_QUEUE_ARN");
  const receiveCount = readInteger("MAX_RECEIVE_COUNT", 5, 1, 1000);
  const refId = `powertuning-${scenario.id}-${randomUUID().slice(0, 8)}`;
  const body = {
    templateId: "generic-report",
    refId,
    webhooks: {
      success: { channel: "sqs", value: callbackArn },
      failure: { channel: "sqs", value: callbackArn },
    },
    options: { pdfA: scenario.pdfA },
    payload: buildPayload(scenario, 0),
  };

  if (!validateJob(body)) {
    throw new Error(
      `Generated Power Tuning job does not satisfy @printer/contracts: ${formatValidationErrors(
        validateJob.errors,
      )}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        Records: [
          {
            messageId: randomUUID(),
            receiptHandle: randomUUID(),
            body: JSON.stringify(body),
            attributes: { ApproximateReceiveCount: String(receiveCount) },
            messageAttributes: {},
            md5OfBody: "",
            eventSource: "aws:sqs",
            eventSourceARN: `arn:aws:sqs:${region}:000000000000:printer-load-test`,
            awsRegion: region,
          },
        ],
      },
      null,
      2,
    ),
  );
}

function assertTarget(throughput, p95, errorCount) {
  const failures = [];
  if (throughput < TARGET_JOBS_PER_MINUTE) {
    failures.push(
      `throughput ${throughput.toFixed(1)} < ${String(TARGET_JOBS_PER_MINUTE)} jobs/min`,
    );
  }
  if (p95 >= TARGET_P95_MILLISECONDS) {
    failures.push(`p95 ${String(p95)} ms >= ${String(TARGET_P95_MILLISECONDS)} ms`);
  }
  if (errorCount > 0) {
    failures.push(`${String(errorCount)} errors`);
  }

  if (failures.length > 0) {
    throw new Error(`Load test missed the candidate target: ${failures.join("; ")}`);
  }
}

function describeMatrix(jobs) {
  const counts = new Map();
  for (const job of jobs) {
    counts.set(job.scenario.id, (counts.get(job.scenario.id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => `${String(count)}x ${id}`)
    .sort()
    .join(", ");
}

function describeFailures(failures) {
  return failures
    .map((entry) => {
      if (!validateResult(entry.result)) {
        return `${entry.result.refId ?? "unknown"}: invalid result`;
      }
      return `${entry.result.refId}: ${entry.result.error?.code ?? "unknown"}`;
    })
    .join(", ");
}

function percentile(values, rank) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((rank / 100) * sorted.length) - 1);
  return sorted[index];
}

function maxOf(values) {
  return values.length === 0 ? 0 : Math.max(...values);
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
    jobsQueueUrl: requiredEnv("JOBS_QUEUE_URL"),
    callbackQueueUrl: requiredEnv("CALLBACK_QUEUE_URL"),
    callbackQueueArn: requiredEnv("CALLBACK_QUEUE_ARN"),
    jobCount: readInteger("LOAD_TEST_JOBS", DEFAULT_JOB_COUNT, 1, MAX_JOBS),
    timeoutSeconds: readInteger("LOAD_TEST_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, 30, 3_600),
    enforceTarget: process.env.LOAD_TEST_ENFORCE_TARGET === "1",
    workerLogGroup: optionalEnv("WORKER_LOG_GROUP"),
  };
}

function readInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
  return value;
}

function requiredEnv(name) {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}
