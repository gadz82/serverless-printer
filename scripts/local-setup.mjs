import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildManifest } from "./template-manifest.mjs";

// The AWS SDK is a runtime dependency of the worker, not of the root package.
// Resolving it from the worker keeps the catalog as the single version source
// and still lets root scripts run with the pinned workspace install.
const workerRequire = createRequire(new URL("../apps/render-worker/package.json", import.meta.url));
const {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
  SetQueueAttributesCommand,
  SQSClient,
} = workerRequire("@aws-sdk/client-sqs");
const { CreateBucketCommand, HeadBucketCommand, S3Client } = workerRequire("@aws-sdk/client-s3");

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
const REGION = process.env.AWS_REGION ?? "eu-central-1";
const JOBS_QUEUE = "printer-jobs";
const JOBS_DLQ = "printer-jobs-dlq";
const SMOKE_RESULTS_QUEUE = "printer-smoke-results";
const PRINTS_BUCKET = "printer-prints-local";
const MAX_RECEIVE_COUNT = 5;
const VISIBILITY_TIMEOUT_SECONDS = 360;

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
};

const sqs = new SQSClient({ region: REGION, endpoint: ENDPOINT, credentials });
const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  credentials,
  // The setup client talks to LocalStack's path-style API; the worker's own
  // S3 client uses AWS_ENDPOINT_URL_S3 to get virtual-host routing.
  forcePathStyle: true,
});

function isMissingResource(error) {
  const status = error?.$metadata?.httpStatusCode;
  const name = error?.name;

  return (
    status === 404 ||
    name === "NotFound" ||
    name === "NoSuchBucket" ||
    name === "QueueDoesNotExist" ||
    name === "AWS.SimpleQueueService.NonExistentQueue"
  );
}

async function getQueueUrl(queueName) {
  try {
    const output = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
    return output.QueueUrl;
  } catch (error) {
    if (isMissingResource(error)) {
      return undefined;
    }
    throw error;
  }
}

async function ensureQueue(queueName, attributes = {}) {
  let queueUrl = await getQueueUrl(queueName);

  if (queueUrl === undefined) {
    const created = await sqs.send(
      new CreateQueueCommand({ QueueName: queueName, Attributes: attributes }),
    );
    queueUrl = created.QueueUrl;
  } else if (Object.keys(attributes).length > 0) {
    await sqs.send(new SetQueueAttributesCommand({ QueueUrl: queueUrl, Attributes: attributes }));
  }

  if (queueUrl === undefined) {
    throw new Error(`LocalStack did not return a URL for queue ${queueName}`);
  }

  const output = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["QueueArn"] }),
  );
  const queueArn = output.Attributes?.QueueArn;

  if (queueArn === undefined) {
    throw new Error(`LocalStack did not return an ARN for queue ${queueName}`);
  }

  return { queueUrl, queueArn };
}

async function ensureBucket(bucketName) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return;
  } catch (error) {
    if (!isMissingResource(error)) {
      throw error;
    }
  }

  const input = { Bucket: bucketName };
  if (REGION !== "us-east-1") {
    input.CreateBucketConfiguration = { LocationConstraint: REGION };
  }
  await s3.send(new CreateBucketCommand(input));
}

async function waitForLocalStack(timeoutMilliseconds = 30_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;

  while (Date.now() < deadline) {
    try {
      await sqs.send(new ListQueuesCommand({ MaxResults: 1 }));
      // A 404 still proves S3 answers; the probe bucket is never created.
      await s3.send(new HeadBucketCommand({ Bucket: "printer-localstack-ready-probe" }));
      return;
    } catch (error) {
      if (isMissingResource(error)) {
        return;
      }
      lastError = error;
    }

    await delay(500);
  }

  throw new Error(
    `LocalStack did not become ready at ${ENDPOINT} within ${timeoutMilliseconds}ms`,
    {
      cause: lastError,
    },
  );
}

async function main() {
  await waitForLocalStack();
  await ensureBucket(PRINTS_BUCKET);

  const deadLetterQueue = await ensureQueue(JOBS_DLQ);
  const jobsQueue = await ensureQueue(JOBS_QUEUE, {
    VisibilityTimeout: String(VISIBILITY_TIMEOUT_SECONDS),
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: deadLetterQueue.queueArn,
      maxReceiveCount: MAX_RECEIVE_COUNT,
    }),
  });
  const smokeResultsQueue = await ensureQueue(SMOKE_RESULTS_QUEUE);

  const manifest = await buildManifest(repositoryRoot, process.env.RELEASE || "local");

  console.log(`LocalStack resources ready at ${ENDPOINT}:`);
  console.log(`  ${JOBS_QUEUE}: ${jobsQueue.queueUrl}`);
  console.log(`  ${JOBS_DLQ}: ${deadLetterQueue.queueUrl}`);
  console.log(`  ${SMOKE_RESULTS_QUEUE}: ${smokeResultsQueue.queueUrl}`);
  console.log(`  ${PRINTS_BUCKET}: s3://${PRINTS_BUCKET}`);
  console.log(
    `  templates.manifest.json: ${path.join(repositoryRoot, "templates.manifest.json")} (${manifest.templates.length} template(s))`,
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

main().catch((error) => {
  console.error(`Local setup failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`Check that LocalStack is running at ${ENDPOINT}. Start it with:`);
  console.error("  docker compose up -d localstack");
  process.exitCode = 1;
});
