import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import type { PrintResult } from "@printer/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqsSendClient } from "../src/adapters/sqs-result-delivery.js";
import { composeWorker } from "../src/composition-root.js";

const SUCCESS_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-results";
const FAILURE_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-failures";

class RecordingSqsClient implements SqsSendClient {
  readonly commands: SendMessageCommand[] = [];

  async send(command: SendMessageCommand): Promise<unknown> {
    this.commands.push(command);
    return {};
  }
}

const failureResult: PrintResult = {
  success: false,
  printId: "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c",
  refId: "invoice-1",
  template: null,
  error: {
    code: "INVALID_MESSAGE",
    message: "invalid",
    retryable: false,
    attempts: 1,
  },
  failedAt: "2026-11-09T10:00:00.000Z",
};

describe("composeWorker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps PDF/A rejected until P-204 wires the configured allowlist", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((argument) => String(argument)).join(" "));
    });
    const sqsClient = new RecordingSqsClient();
    const runtime = composeWorker(
      {
        PRINTS_BUCKET: "printer-prints",
        PDFA_ALLOWED_LEVELS: "PDF/A-2b",
      },
      { sqsClient },
    );

    expect(runtime.config.pdfaAllowedLevels).toEqual(["PDF/A-2b"]);

    const result = await runtime.processPrintJob.execute({
      messageId: "message-1",
      job: {
        templateId: "_smoke",
        refId: "invoice-1",
        options: { pdfA: "PDF/A-2b" },
        webhooks: {
          success: { channel: "sqs", value: SUCCESS_ARN },
          failure: { channel: "sqs", value: FAILURE_ARN },
        },
      },
      attempt: 1,
      maxAttempts: 5,
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "PDFA_LEVEL_NOT_ALLOWED",
        message: "PDF/A level not allowed: PDF/A-2b",
        retryable: false,
        attempts: 1,
      },
    });
    expect(sqsClient.commands).toHaveLength(1);
    expect(sqsClient.commands[0]?.input.QueueUrl).toContain("printer-failures");

    const warning = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry["event"] === "pdfa_levels_ignored");
    expect(warning).toBeDefined();
  });

  it("wires SQS_ENDPOINT_URL into result delivery", async () => {
    const sqsClient = new RecordingSqsClient();
    const runtime = composeWorker(
      {
        PRINTS_BUCKET: "printer-prints",
        SQS_ENDPOINT_URL: "http://localhost:4566/",
      },
      { sqsClient },
    );

    await runtime.resultDelivery.deliver(failureResult, {
      target: { channel: "sqs", value: SUCCESS_ARN },
      refId: "invoice-1",
      messageId: "message-1",
    });

    expect(sqsClient.commands[0]?.input.QueueUrl).toBe(
      "http://localhost:4566/123456789012/printer-results",
    );
  });

  it("fails cold-start composition when the manifest is missing", () => {
    const missingManifestPath = join(tmpdir(), `${randomUUID()}.templates.manifest.json`);

    let thrown: unknown;
    try {
      composeWorker({
        PRINTS_BUCKET: "printer-prints",
        TEMPLATE_MANIFEST_PATH: missingManifestPath,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("cannot read template manifest at");
    expect((thrown as Error).message).toContain(missingManifestPath);
  });

  it("fails cold-start composition when the manifest is corrupt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "printer-worker-manifest-"));
    const manifestPath = join(directory, "templates.manifest.json");
    try {
      await writeFile(manifestPath, "{not-json", "utf8");

      expect(() =>
        composeWorker({
          PRINTS_BUCKET: "printer-prints",
          TEMPLATE_MANIFEST_PATH: manifestPath,
        }),
      ).toThrow(new RegExp(`template manifest at .*templates\\.manifest\\.json is not valid JSON`));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
