import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { CallbackNotAllowed, type PrintResult } from "@printer/domain";
import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SqsSendClient } from "../src/adapters/sqs-result-delivery.js";
import { composeWorker } from "../src/composition-root.js";
import type { EventBridgePutEventsClient } from "../src/delivery/eventbridge-result-delivery.js";
import type { PinnedHttpRequest, PinnedHttpRequestInput } from "../src/delivery/http-request.js";
import type { LambdaInvokeClient } from "../src/delivery/lambda-result-delivery.js";
import { ChromiumPdfRenderer } from "../src/rendering/chromium-pdf-renderer.js";
import { LocalChromeRenderer } from "../src/rendering/local-chrome-renderer.js";
import { TemplatePdfRenderer } from "../src/rendering/template-pdf-renderer.js";
import { RecordingHttpRequest, policyFor } from "./support/delivery.js";
import { FixedPrintRepository } from "./support/fakes.js";

const SUCCESS_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-results";
const FAILURE_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-failures";
const FUNCTION_ARN = "arn:aws:lambda:eu-central-1:123456789012:function:printer-callback";
const BUS_ARN = "arn:aws:events:eu-central-1:123456789012:event-bus/printer-callbacks";
const HTTP_URL = "https://callbacks.example.com/print";
const PRESIGNED_URL = "https://203.0.113.10/upload?X-Amz-Signature=abc";

class RecordingSqsClient implements SqsSendClient {
  readonly commands: SendMessageCommand[] = [];

  async send(command: SendMessageCommand): Promise<unknown> {
    this.commands.push(command);
    return {};
  }
}

class RecordingLambdaClient implements LambdaInvokeClient {
  readonly commands: InvokeCommand[] = [];

  async send(command: InvokeCommand): Promise<{ StatusCode: number }> {
    this.commands.push(command);
    return { StatusCode: 202 };
  }
}

class RecordingEventBridgeClient implements EventBridgePutEventsClient {
  readonly commands: PutEventsCommand[] = [];

  async send(command: PutEventsCommand): Promise<{ FailedEntryCount: number }> {
    this.commands.push(command);
    return { FailedEntryCount: 0 };
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

async function blankPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  return document.save({ useObjectStreams: false });
}

describe("composeWorker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wires the configured PDF/A allowlist and archives an allowed level", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const sqsClient = new RecordingSqsClient();
    const pdf = await blankPdf();
    const runtime = composeWorker(
      {
        PRINTS_BUCKET: "printer-prints",
        PDFA_ALLOWED_LEVELS: "PDF/A-2b",
      },
      {
        sqsClient,
        pdfRenderer: { render: async () => pdf },
        printRepository: new FixedPrintRepository(),
      },
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
      success: true,
      pdfA: "PDF/A-2b",
      printing: expect.stringContaining("X-Amz-Signature"),
    });
    expect(sqsClient.commands).toHaveLength(1);
    expect(sqsClient.commands[0]?.input.QueueUrl).toContain("printer-results");
  });

  it("selects the template renderer and all five delivery channels", async () => {
    const sqsClient = new RecordingSqsClient();
    const lambdaClient = new RecordingLambdaClient();
    const eventBridgeClient = new RecordingEventBridgeClient();
    const http = new RecordingHttpRequest();
    const uploads: PinnedHttpRequestInput[] = [];
    const s3Request: PinnedHttpRequest = async (request) => {
      uploads.push(request);
      return { status: 200 };
    };
    const runtime = composeWorker(
      { PRINTS_BUCKET: "printer-prints" },
      {
        sqsClient,
        lambdaClient,
        eventBridgeClient,
        httpRequest: http.request,
        s3Request,
        callbackPolicy: policyFor(["https://callbacks.example.com"]),
      },
    );

    expect(runtime.pdfRenderer).toBeInstanceOf(TemplatePdfRenderer);

    await runtime.resultDelivery.deliver(
      failureResult,
      deliveryContext({ channel: "http", value: HTTP_URL }),
    );
    await runtime.resultDelivery.deliver(
      failureResult,
      deliveryContext({ channel: "lambda", value: FUNCTION_ARN }),
    );
    await runtime.resultDelivery.deliver(
      failureResult,
      deliveryContext({ channel: "eventBridge", value: BUS_ARN }),
    );
    await runtime.resultDelivery.deliver(
      failureResult,
      deliveryContext({ channel: "sqs", value: SUCCESS_ARN }),
    );
    await runtime.pdfDestination.deliverPdf({
      target: { channel: "s3", value: PRESIGNED_URL },
      printId: failureResult.printId,
      messageId: "message-1",
      pdfBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });

    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.headers["X-Printer-Print-Id"]).toBe(failureResult.printId);
    expect(lambdaClient.commands[0]?.input.FunctionName).toBe(FUNCTION_ARN);
    expect(eventBridgeClient.commands[0]?.input.Entries?.[0]?.Source).toBe("printer");
    expect(sqsClient.commands[0]?.input.QueueUrl).toContain("printer-results");
    expect(uploads[0]?.url).toEqual(new URL(PRESIGNED_URL));
    expect(uploads[0]?.method).toBe("PUT");
  });

  it("selects LocalChromeRenderer outside Lambda", () => {
    const runtime = composeWorker(
      { PRINTS_BUCKET: "printer-prints" },
      { sqsClient: new RecordingSqsClient() },
    );

    expect((runtime.pdfRenderer as TemplatePdfRenderer).chromium).toBeInstanceOf(
      LocalChromeRenderer,
    );
  });

  it("selects ChromiumPdfRenderer on Lambda", () => {
    const runtime = composeWorker(
      {
        PRINTS_BUCKET: "printer-prints",
        AWS_LAMBDA_FUNCTION_NAME: "printer-worker",
      },
      { sqsClient: new RecordingSqsClient() },
    );

    expect((runtime.pdfRenderer as TemplatePdfRenderer).chromium).toBeInstanceOf(
      ChromiumPdfRenderer,
    );
  });

  it.each([
    ["local", { AWS_LAMBDA_FUNCTION_NAME: "printer-worker" }, LocalChromeRenderer],
    ["lambda", {}, ChromiumPdfRenderer],
  ])("honours the explicit PDF_RENDERER=%s mode", (mode, env, rendererClass) => {
    const runtime = composeWorker(
      { PRINTS_BUCKET: "printer-prints", PDF_RENDERER: mode, ...env },
      { sqsClient: new RecordingSqsClient() },
    );

    expect((runtime.pdfRenderer as TemplatePdfRenderer).chromium).toBeInstanceOf(rendererClass);
  });

  it("applies the callback policy through the composed delivery path", async () => {
    const http = new RecordingHttpRequest();
    const runtime = composeWorker(
      { PRINTS_BUCKET: "printer-prints" },
      {
        sqsClient: new RecordingSqsClient(),
        httpRequest: http.request,
        callbackPolicy: policyFor(["https://callbacks.example.com"]),
      },
    );

    await expect(
      runtime.resultDelivery.deliver(
        failureResult,
        deliveryContext({ channel: "http", value: "https://unlisted.example.com/print" }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(http.calls).toHaveLength(0);
  });

  it("does not expose s3 through the JSON result-delivery router", async () => {
    const runtime = composeWorker(
      { PRINTS_BUCKET: "printer-prints" },
      { sqsClient: new RecordingSqsClient() },
    );

    await expect(
      runtime.resultDelivery.deliver(
        failureResult,
        deliveryContext({ channel: "s3", value: PRESIGNED_URL }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
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

function deliveryContext(target: {
  readonly channel: "http" | "lambda" | "sqs" | "eventBridge" | "s3";
  readonly value: string;
  readonly pingUrl?: string | null;
}) {
  return {
    target,
    refId: "invoice-1",
    messageId: "message-1",
  };
}
