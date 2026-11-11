import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatValidationErrors, validateJob } from "../../packages/contracts/src/index.js";

const EXAMPLES_ROOT = fileURLToPath(new URL("../../examples", import.meta.url));
const REQUIRED_FILES = ["README.md", "config.tfvars.example", "sqs-payload.json"];

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function exampleDirectories(): Promise<string[]> {
  const entries = await readdir(EXAMPLES_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function successChannel(payload: JsonObject): string | undefined {
  const webhooks = payload.webhooks;
  if (!isObject(webhooks) || !isObject(webhooks.success)) {
    return undefined;
  }
  return typeof webhooks.success.channel === "string" ? webhooks.success.channel : undefined;
}

describe("output channel examples", () => {
  it("contains between six and eight examples", async () => {
    const directories = await exampleDirectories();
    expect(directories.length).toBeGreaterThanOrEqual(6);
    expect(directories.length).toBeLessThanOrEqual(8);
    expect(directories).toEqual([
      "01-http-standard",
      "02-http-pdfa",
      "03-lambda-callback",
      "04-sqs-fifo",
      "05-eventbridge-callback",
      "06-s3-pdfa",
      "07-private-http-vpc",
      "08-eventbridge-ingress",
    ]);
  });

  it("validates every SQS payload and the ingress event detail", async () => {
    const directories = await exampleDirectories();
    const refIds = new Set<string>();
    const channels = new Set<string>();

    for (const directory of directories) {
      const exampleDirectory = path.join(EXAMPLES_ROOT, directory);
      for (const file of REQUIRED_FILES) {
        await expect(readFile(path.join(exampleDirectory, file), "utf8")).resolves.toBeTruthy();
      }

      const payload = await readJson(path.join(exampleDirectory, "sqs-payload.json"));
      expect(isObject(payload), `${directory}: SQS payload must be a JSON object`).toBe(true);
      if (!isObject(payload)) {
        continue;
      }

      expect(
        validateJob(payload),
        `${directory}: ${formatValidationErrors(validateJob.errors)}`,
      ).toBe(true);
      refIds.add(JSON.stringify(payload.refId));

      const channel = successChannel(payload);
      expect(channel, `${directory}: missing success channel`).toBeDefined();
      if (channel !== undefined) {
        channels.add(channel);
      }

      try {
        await readFile(path.join(exampleDirectory, "event.json"), "utf8");
      } catch {
        continue;
      }

      const event = await readJson(path.join(exampleDirectory, "event.json"));
      expect(isObject(event), `${directory}: event must be a JSON object`).toBe(true);
      if (isObject(event)) {
        expect(
          validateJob(event.detail),
          `${directory} event detail: ${formatValidationErrors(validateJob.errors)}`,
        ).toBe(true);
        expect(event.detail).toEqual(payload);
      }
    }

    expect(refIds.size).toBe(directories.length);
    expect([...channels].sort()).toEqual(["eventBridge", "http", "lambda", "s3", "sqs"]);
  });
});
