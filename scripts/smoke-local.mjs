import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRequire = createRequire(new URL("../apps/render-worker/package.json", import.meta.url));
const { SendMessageCommand, SQSClient } = workerRequire("@aws-sdk/client-sqs");

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const resultsPath = path.join(repositoryRoot, ".local", "results.jsonl");
const endpoint = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
const region = process.env.AWS_REGION ?? "eu-central-1";
const jobsQueueUrl =
  process.env.JOBS_QUEUE_URL ?? `${endpoint.replace(/\/+$/, "")}/000000000000/printer-jobs`;
const smokeResultsArn = `arn:aws:sqs:${region}:000000000000:printer-smoke-results`;
const refId = `smoke-local-${Date.now()}`;
const timeoutMilliseconds = 30_000;
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
};

const sqs = new SQSClient({ region, endpoint, credentials, maxAttempts: 3 });
const job = {
  templateId: "_smoke",
  refId,
  webhooks: {
    success: { channel: "sqs", value: smokeResultsArn },
  },
  payload: { message: "Printer smoke" },
};

console.log(`Sending _smoke job ${refId} to ${jobsQueueUrl}`);
await sqs.send(
  new SendMessageCommand({ QueueUrl: jobsQueueUrl, MessageBody: JSON.stringify(job) }),
);

const result = await waitForResult(refId);
if (result === undefined) {
  console.error(
    `Timed out after ${timeoutMilliseconds / 1_000}s waiting for ${refId} in ${resultsPath}.`,
  );
  console.error("Check that `pnpm worker:local` and `pnpm sink:local` are running.");
  process.exitCode = 1;
} else if (result.success !== true) {
  const errorCode = result.error?.code ?? "UNKNOWN";
  const errorMessage = result.error?.message ?? "callback did not report success=true";
  console.error(`Smoke job ${refId} failed (${errorCode}): ${errorMessage}`);
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result, null, 2));
}

async function waitForResult(expectedRefId) {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const lines = await readResultLines();
    for (const line of lines) {
      let candidate;
      try {
        candidate = JSON.parse(line);
      } catch {
        continue;
      }

      if (candidate?.refId === expectedRefId) {
        return candidate;
      }
    }

    await delay(500);
  }

  return undefined;
}

async function readResultLines() {
  try {
    const contents = await readFile(resultsPath, "utf8");
    return contents.split("\n").filter((line) => line.trim().length > 0);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
