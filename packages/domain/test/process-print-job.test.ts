import { describe, expect, it } from "vitest";

import {
  DeliveryFailed,
  PdfRenderFailed,
  ProcessPrintJob,
  TemplateRenderFailed,
} from "../src/index.js";
import type {
  CallbackTarget,
  PdfaLevel,
  PrintFailureResult,
  PrintJob,
  PrintResult,
  PrintSuccessResult,
  ProcessPrintJobDependencies,
  RefId,
} from "../src/index.js";
import {
  ARCHIVED_PDF_BYTES,
  FakeIdGenerator,
  FakeLogger,
  FakePdfArchiver,
  FakePdfRenderer,
  FakePrintRepository,
  FakeResultDelivery,
  FixedClock,
  InMemoryTemplateCatalog,
  PDF_BYTES,
  storedPrint,
  template,
} from "./support/fakes.js";

const FIXED_NOW = new Date("2026-11-09T10:00:00.000Z");
const MESSAGE_ID = "message-1";

const SQS_SUCCESS: CallbackTarget = {
  channel: "sqs",
  value: "arn:aws:sqs:eu-central-1:123456789012:printer-results",
};

const SQS_FAILURE: CallbackTarget = {
  channel: "sqs",
  value: "arn:aws:sqs:eu-central-1:123456789012:printer-failures",
};

const baseJob: PrintJob = {
  templateId: template.slug,
  refId: "invoice-2026-0001",
  options: { pdfA: false },
  webhooks: { success: SQS_SUCCESS, failure: SQS_FAILURE },
  payload: { message: "Printer smoke" },
};

function buildDependencies(
  overrides: Partial<ProcessPrintJobDependencies> = {},
): ProcessPrintJobDependencies {
  return {
    templateCatalog: new InMemoryTemplateCatalog(),
    pdfRenderer: new FakePdfRenderer(),
    pdfArchiver: new FakePdfArchiver(),
    printRepository: new FakePrintRepository(),
    resultDelivery: new FakeResultDelivery(),
    clock: new FixedClock(FIXED_NOW),
    idGenerator: new FakeIdGenerator(),
    logger: new FakeLogger(),
    supportedChannels: ["sqs"],
    pdfaAllowedLevels: [],
    ...overrides,
  };
}

function expectSuccess(result: PrintResult): PrintSuccessResult {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("expected a success result");
  }
  return result;
}

function expectFailure(result: PrintResult): PrintFailureResult {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("expected a failure result");
  }
  return result;
}

describe("ProcessPrintJob", () => {
  it("renders, stores and delivers a success result through the ports", async () => {
    const catalog = new InMemoryTemplateCatalog();
    const renderer = new FakePdfRenderer();
    const repository = new FakePrintRepository();
    const delivery = new FakeResultDelivery();
    const idGenerator = new FakeIdGenerator();
    const logger = new FakeLogger();
    const useCase = new ProcessPrintJob(
      buildDependencies({
        templateCatalog: catalog,
        pdfRenderer: renderer,
        printRepository: repository,
        resultDelivery: delivery,
        idGenerator,
        logger,
      }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: baseJob,
      attempt: 1,
      maxAttempts: 5,
    });

    const expected: PrintSuccessResult = {
      success: true,
      printId: `print-${MESSAGE_ID}`,
      refId: baseJob.refId,
      printing: storedPrint.printing,
      printingExpiresAt: storedPrint.printingExpiresAt,
      sha256: storedPrint.sha256,
      sizeBytes: storedPrint.sizeBytes,
      pdfA: null,
      template: {
        id: template.id,
        slug: template.slug,
        contentHash: template.contentHash,
        release: template.release,
      },
      renderedAt: FIXED_NOW.toISOString(),
    };

    expect(result).toEqual(expected);
    expect(idGenerator.calls).toEqual([MESSAGE_ID]);
    expect(catalog.requested).toEqual([template.slug]);
    expect(renderer.calls).toEqual([{ template, payload: baseJob.payload, pdfA: null }]);
    expect(repository.calls).toHaveLength(1);
    expect(repository.calls[0]?.printId).toBe(`print-${MESSAGE_ID}`);
    expect(repository.calls[0]?.templateBytes).toBe(PDF_BYTES);
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]).toEqual({
      result: expected,
      context: {
        target: SQS_SUCCESS,
        refId: baseJob.refId,
        messageId: MESSAGE_ID,
      },
    });
    expect(logger.entries).toEqual([
      {
        level: "info",
        event: "print_job_succeeded",
        fields: {
          messageId: MESSAGE_ID,
          printId: `print-${MESSAGE_ID}`,
          templateId: template.id,
          attempt: 1,
        },
      },
    ]);
  });

  it("delivers TEMPLATE_NOT_FOUND without rendering when the template is unknown", async () => {
    const catalog = new InMemoryTemplateCatalog([]);
    const renderer = new FakePdfRenderer();
    const delivery = new FakeResultDelivery();
    const useCase = new ProcessPrintJob(
      buildDependencies({
        templateCatalog: catalog,
        pdfRenderer: renderer,
        resultDelivery: delivery,
      }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: { ...baseJob, templateId: "missing-template" },
      attempt: 1,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure).toEqual({
      success: false,
      printId: `print-${MESSAGE_ID}`,
      refId: baseJob.refId,
      template: null,
      error: {
        code: "TEMPLATE_NOT_FOUND",
        message: "template not found: missing-template",
        retryable: false,
        attempts: 1,
      },
      failedAt: FIXED_NOW.toISOString(),
    });
    expect(catalog.requested).toEqual(["missing-template"]);
    expect(renderer.calls).toHaveLength(0);
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.result).toEqual(failure);
  });

  it("rejects a PDF/A level outside the allowed list before resolving the template", async () => {
    const catalog = new InMemoryTemplateCatalog();
    const renderer = new FakePdfRenderer();
    const useCase = new ProcessPrintJob(
      buildDependencies({
        templateCatalog: catalog,
        pdfRenderer: renderer,
        pdfaAllowedLevels: ["PDF/A-3b"],
      }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: { ...baseJob, options: { pdfA: "PDF/A-2b" } },
      attempt: 1,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure.error).toEqual({
      code: "PDFA_LEVEL_NOT_ALLOWED",
      message: "PDF/A level not allowed: PDF/A-2b",
      retryable: false,
      attempts: 1,
    });
    expect(failure.template).toBeNull();
    expect(catalog.requested).toHaveLength(0);
    expect(renderer.calls).toHaveLength(0);
  });

  it("checks PDF/A before the callback channel", async () => {
    const useCase = new ProcessPrintJob(
      buildDependencies({ pdfaAllowedLevels: [], supportedChannels: ["sqs"] }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: {
        ...baseJob,
        options: { pdfA: "PDF/A-2b" },
        webhooks: {
          success: { channel: "http", value: "https://callbacks.example.com/print" },
          failure: SQS_FAILURE,
        },
      },
      attempt: 1,
      maxAttempts: 5,
    });

    expect(expectFailure(result).error.code).toBe("PDFA_LEVEL_NOT_ALLOWED");
  });

  it("passes an allowed PDF/A level to the renderer and echoes it in the result", async () => {
    const renderer = new FakePdfRenderer();
    const useCase = new ProcessPrintJob(
      buildDependencies({
        pdfRenderer: renderer,
        pdfaAllowedLevels: ["PDF/A-2b"] satisfies readonly PdfaLevel[],
      }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: { ...baseJob, options: { pdfA: "PDF/A-2b" } },
      attempt: 1,
      maxAttempts: 5,
    });

    expect(expectSuccess(result).pdfA).toBe("PDF/A-2b");
    expect(renderer.calls[0]?.pdfA).toBe("PDF/A-2b");
  });

  it("does not archive a standard PDF", async () => {
    const archiver = new FakePdfArchiver();
    const repository = new FakePrintRepository();
    const useCase = new ProcessPrintJob(
      buildDependencies({ pdfArchiver: archiver, printRepository: repository }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: baseJob,
      attempt: 1,
      maxAttempts: 5,
    });

    expect(expectSuccess(result).pdfA).toBeNull();
    expect(archiver.calls).toHaveLength(0);
    expect(repository.calls[0]?.templateBytes).toBe(PDF_BYTES);
  });

  it("archives a PDF/A request before storage and stores the archival bytes", async () => {
    const archiver = new FakePdfArchiver();
    const repository = new FakePrintRepository();
    const useCase = new ProcessPrintJob(
      buildDependencies({
        pdfArchiver: archiver,
        printRepository: repository,
        pdfaAllowedLevels: ["PDF/A-2b"],
      }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: { ...baseJob, options: { pdfA: "PDF/A-2b" } },
      attempt: 1,
      maxAttempts: 5,
    });

    expect(expectSuccess(result).pdfA).toBe("PDF/A-2b");
    expect(archiver.calls).toEqual([{ level: "PDF/A-2b", createdAt: FIXED_NOW }]);
    expect(repository.calls[0]?.templateBytes).toBe(ARCHIVED_PDF_BYTES);
  });

  it("maps an archiver failure to PDFA_CONVERSION_FAILED without storing", async () => {
    const archiver = new FakePdfArchiver(async () => {
      throw new Error("font is not embedded: Helvetica");
    });
    const repository = new FakePrintRepository();
    const delivery = new FakeResultDelivery();
    const useCase = new ProcessPrintJob(
      buildDependencies({
        pdfArchiver: archiver,
        printRepository: repository,
        resultDelivery: delivery,
        pdfaAllowedLevels: ["PDF/A-2b"],
      }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: { ...baseJob, options: { pdfA: "PDF/A-2b" } },
      attempt: 1,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure.error).toEqual({
      code: "PDFA_CONVERSION_FAILED",
      message: "PDF/A conversion failed: font is not embedded: Helvetica",
      retryable: false,
      attempts: 1,
    });
    expect(failure.template).not.toBeNull();
    expect(repository.calls).toHaveLength(0);
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.context.target).toEqual(SQS_FAILURE);
  });

  it("rejects an unsupported success channel before resolving or rendering", async () => {
    const catalog = new InMemoryTemplateCatalog();
    const renderer = new FakePdfRenderer();
    const useCase = new ProcessPrintJob(
      buildDependencies({ templateCatalog: catalog, pdfRenderer: renderer }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: {
        ...baseJob,
        webhooks: {
          success: { channel: "http", value: "https://callbacks.example.com/print" },
          failure: SQS_FAILURE,
        },
      },
      attempt: 1,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure.error).toEqual({
      code: "CALLBACK_NOT_ALLOWED",
      message: "unsupported callback channel: http",
      retryable: false,
      attempts: 1,
    });
    expect(catalog.requested).toHaveLength(0);
    expect(renderer.calls).toHaveLength(0);
  });

  it("rejects an unsupported failure channel before resolving or rendering", async () => {
    const catalog = new InMemoryTemplateCatalog();
    const renderer = new FakePdfRenderer();
    const delivery = new FakeResultDelivery();
    const useCase = new ProcessPrintJob(
      buildDependencies({
        templateCatalog: catalog,
        pdfRenderer: renderer,
        resultDelivery: delivery,
      }),
    );
    const job: PrintJob = {
      ...baseJob,
      webhooks: {
        success: SQS_SUCCESS,
        failure: { channel: "lambda", value: "arn:aws:lambda:eu-central-1:123:function:cb" },
      },
    };

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job,
      attempt: 1,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure.error.code).toBe("CALLBACK_NOT_ALLOWED");
    expect(failure.error.message).toContain("lambda");
    expect(catalog.requested).toHaveLength(0);
    expect(renderer.calls).toHaveLength(0);
    expect(delivery.deliveries[0]?.context.target).toEqual(job.webhooks.failure);
  });

  it("delivers a non-retryable renderer failure without rethrowing", async () => {
    const renderer = new FakePdfRenderer(async () => {
      throw new TemplateRenderFailed("handlebars failed");
    });
    const delivery = new FakeResultDelivery();
    const useCase = new ProcessPrintJob(
      buildDependencies({ pdfRenderer: renderer, resultDelivery: delivery }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: baseJob,
      attempt: 1,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure.error).toEqual({
      code: "TEMPLATE_RENDER_FAILED",
      message: "handlebars failed",
      retryable: false,
      attempts: 1,
    });
    expect(failure.template).toEqual({
      id: template.id,
      slug: template.slug,
      contentHash: template.contentHash,
      release: template.release,
    });
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.result).toEqual(failure);
  });

  it("rethrows a retryable error before the last attempt without delivering", async () => {
    const error = new PdfRenderFailed("renderer crashed");
    const renderer = new FakePdfRenderer(async () => {
      throw error;
    });
    const delivery = new FakeResultDelivery();
    const logger = new FakeLogger();
    const useCase = new ProcessPrintJob(
      buildDependencies({
        pdfRenderer: renderer,
        resultDelivery: delivery,
        logger,
      }),
    );

    await expect(
      useCase.execute({
        messageId: MESSAGE_ID,
        job: baseJob,
        attempt: 2,
        maxAttempts: 5,
      }),
    ).rejects.toBe(error);
    expect(delivery.deliveries).toHaveLength(0);
    expect(logger.entries).toEqual([
      {
        level: "warn",
        event: "print_job_retry",
        fields: {
          messageId: MESSAGE_ID,
          printId: `print-${MESSAGE_ID}`,
          templateId: template.id,
          attempt: 2,
          errorCode: "PDF_RENDER_FAILED",
        },
      },
    ]);
  });

  it("delivers a retryable failure on the last attempt and does not rethrow", async () => {
    const renderer = new FakePdfRenderer(async () => {
      throw new PdfRenderFailed("renderer crashed");
    });
    const delivery = new FakeResultDelivery();
    const job: PrintJob = {
      ...baseJob,
      webhooks: { success: SQS_SUCCESS, failure: SQS_FAILURE },
    };
    const useCase = new ProcessPrintJob(
      buildDependencies({ pdfRenderer: renderer, resultDelivery: delivery }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job,
      attempt: 5,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure.error).toEqual({
      code: "PDF_RENDER_FAILED",
      message: "renderer crashed",
      retryable: true,
      attempts: 5,
    });
    expect(failure.template).toEqual({
      id: template.id,
      slug: template.slug,
      contentHash: template.contentHash,
      release: template.release,
    });
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.context.target).toEqual(SQS_FAILURE);
  });

  it("rethrows when failure delivery itself fails on the last attempt", async () => {
    const deliveryError = new DeliveryFailed("callback unavailable");
    const renderer = new FakePdfRenderer(async () => {
      throw new PdfRenderFailed("renderer crashed");
    });
    const delivery = new FakeResultDelivery(() => Promise.reject(deliveryError));
    const useCase = new ProcessPrintJob(
      buildDependencies({ pdfRenderer: renderer, resultDelivery: delivery }),
    );

    await expect(
      useCase.execute({
        messageId: MESSAGE_ID,
        job: baseJob,
        attempt: 5,
        maxAttempts: 5,
      }),
    ).rejects.toBe(deliveryError);
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.result).toMatchObject({
      success: false,
      error: { code: "PDF_RENDER_FAILED", retryable: true, attempts: 5 },
    });
  });

  it("rethrows without using the success callback when the job has no failure callback", async () => {
    const renderer = new FakePdfRenderer(async () => {
      throw new PdfRenderFailed("renderer crashed");
    });
    const delivery = new FakeResultDelivery();
    const useCase = new ProcessPrintJob(
      buildDependencies({ pdfRenderer: renderer, resultDelivery: delivery }),
    );
    const job: PrintJob = { ...baseJob, webhooks: { success: SQS_SUCCESS } };

    await expect(
      useCase.execute({
        messageId: MESSAGE_ID,
        job,
        attempt: 5,
        maxAttempts: 5,
      }),
    ).rejects.toThrow("no failure callback configured");
    expect(delivery.deliveries).toHaveLength(0);
  });

  it("rethrows a success-delivery failure before the last attempt", async () => {
    const deliveryError = new DeliveryFailed("success callback unavailable");
    const delivery = new FakeResultDelivery(({ result }) =>
      result.success ? Promise.reject(deliveryError) : Promise.resolve(),
    );
    const useCase = new ProcessPrintJob(buildDependencies({ resultDelivery: delivery }));

    await expect(
      useCase.execute({
        messageId: MESSAGE_ID,
        job: baseJob,
        attempt: 1,
        maxAttempts: 5,
      }),
    ).rejects.toBe(deliveryError);
    expect(delivery.deliveries).toHaveLength(1);
    expect(delivery.deliveries[0]?.result.success).toBe(true);
  });

  it("maps a success-delivery failure to DELIVERY_FAILED on the last attempt", async () => {
    const deliveryError = new DeliveryFailed("success callback unavailable");
    const delivery = new FakeResultDelivery(({ result }) =>
      result.success ? Promise.reject(deliveryError) : Promise.resolve(),
    );
    const job: PrintJob = {
      ...baseJob,
      webhooks: { success: SQS_SUCCESS, failure: SQS_FAILURE },
    };
    const useCase = new ProcessPrintJob(buildDependencies({ resultDelivery: delivery }));

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job,
      attempt: 5,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure.error).toEqual({
      code: "DELIVERY_FAILED",
      message: "success callback unavailable",
      retryable: true,
      attempts: 5,
    });
    expect(failure.template).not.toBeNull();
    expect(delivery.deliveries).toHaveLength(2);
    expect(delivery.deliveries[1]?.context.target).toEqual(SQS_FAILURE);
  });

  it("preserves an object refId and uses the clock for the rendered time", async () => {
    const refId: RefId = {
      invoice: "INV-2026-0001",
      lines: [1, 2, 3],
      customer: { name: "Ada Lovelace" },
    };
    const useCase = new ProcessPrintJob(buildDependencies());

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: { ...baseJob, refId },
      attempt: 1,
      maxAttempts: 5,
    });
    const success = expectSuccess(result);

    expect(success.refId).toBe(refId);
    expect(success.refId).toEqual(refId);
    expect(success.renderedAt).toBe(FIXED_NOW.toISOString());
  });

  it("uses the clock for the failed time and preserves an object refId", async () => {
    const refId: RefId = { invoice: "INV-2026-0002" };
    const useCase = new ProcessPrintJob(
      buildDependencies({ templateCatalog: new InMemoryTemplateCatalog([]) }),
    );

    const result = await useCase.execute({
      messageId: MESSAGE_ID,
      job: { ...baseJob, refId, templateId: "missing-template" },
      attempt: 1,
      maxAttempts: 5,
    });
    const failure = expectFailure(result);

    expect(failure.refId).toBe(refId);
    expect(failure.failedAt).toBe(FIXED_NOW.toISOString());
  });

  it("does not log the payload or refId", async () => {
    const logger = new FakeLogger();
    const useCase = new ProcessPrintJob(buildDependencies({ logger }));
    const job: PrintJob = {
      ...baseJob,
      refId: "ref-secret-value",
      payload: { secret: "payload-secret-value" },
    };

    await useCase.execute({
      messageId: MESSAGE_ID,
      job,
      attempt: 1,
      maxAttempts: 5,
    });

    const serialized = JSON.stringify(logger.entries);
    expect(serialized).not.toContain("ref-secret-value");
    expect(serialized).not.toContain("payload-secret-value");
    expect(serialized).not.toContain("refId");
    expect(serialized).not.toContain("payload");
  });
});
