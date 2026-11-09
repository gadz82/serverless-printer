import {
  CallbackNotAllowed,
  DeliveryFailed,
  PdfaLevelNotAllowed,
  PdfRenderFailed,
  TemplateNotFound,
  isPrintJobError,
} from "../domain/errors.js";
import type { PrintJobError } from "../domain/errors.js";
import type { PrintJob } from "../domain/print-job.js";
import type { PdfaLevel } from "../domain/print-options.js";
import type {
  PrintFailureResult,
  PrintResult,
  PrintSuccessResult,
} from "../domain/print-result.js";
import type { TemplateDescriptor, TemplateMetadata } from "../domain/template-descriptor.js";
import type { CallbackChannel } from "../domain/webhooks.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { Logger } from "../ports/logger.js";
import type { PdfRenderer } from "../ports/pdf-renderer.js";
import type { PrintRepository } from "../ports/print-repository.js";
import type { ResultDelivery } from "../ports/result-delivery.js";
import type { TemplateCatalog } from "../ports/template-catalog.js";

export type ProcessPrintJobInput = {
  readonly messageId: string;
  readonly job: PrintJob;
  readonly attempt: number;
  readonly maxAttempts: number;
};

export type ProcessPrintJobDependencies = {
  readonly templateCatalog: TemplateCatalog;
  readonly pdfRenderer: PdfRenderer;
  readonly printRepository: PrintRepository;
  readonly resultDelivery: ResultDelivery;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
  readonly supportedChannels: readonly CallbackChannel[];
  readonly pdfaAllowedLevels: readonly PdfaLevel[];
};

/**
 * Turns one validated job into one stored print or one delivered failure.
 *
 * Retryable errors are rethrown before the last attempt so the queue can
 * redeliver the message. On the last attempt the failure result is delivered;
 * if delivery itself fails the error escapes for the dead-letter queue.
 */
export class ProcessPrintJob {
  constructor(private readonly dependencies: ProcessPrintJobDependencies) {}

  async execute(input: ProcessPrintJobInput): Promise<PrintResult> {
    const { job, messageId, attempt, maxAttempts } = input;
    const printId = this.dependencies.idGenerator.forMessage(messageId);
    let template: TemplateDescriptor | null = null;

    try {
      const pdfA = this.allowedPdfaLevel(job);
      this.assertSupportedChannels(job);
      template = await this.dependencies.templateCatalog.resolve(job.templateId);
      if (template === null) {
        throw new TemplateNotFound(`template not found: ${job.templateId}`);
      }

      const bytes = await this.dependencies.pdfRenderer.render({
        template,
        payload: job.payload ?? {},
        pdfA,
      });
      const renderedAt = this.dependencies.clock.now().toISOString();
      const stored = await this.dependencies.printRepository.store({
        printId,
        templateBytes: bytes,
      });
      const result: PrintSuccessResult = {
        success: true,
        printId,
        refId: job.refId,
        printing: stored.printing,
        printingExpiresAt: stored.printingExpiresAt,
        sha256: stored.sha256,
        sizeBytes: stored.sizeBytes,
        pdfA,
        template: templateMetadata(template),
        renderedAt,
      };

      await this.deliverSuccess(result, job, messageId);
      this.dependencies.logger.info("print_job_succeeded", {
        messageId,
        printId,
        templateId: template.id,
        attempt,
      });

      return result;
    } catch (error) {
      const failureError = normalizeProcessingError(error);
      const fields = {
        messageId,
        printId,
        templateId: template?.id ?? job.templateId,
        attempt,
        errorCode: failureError.code,
      };

      if (failureError.retryable && attempt < maxAttempts) {
        this.dependencies.logger.warn("print_job_retry", fields);
        throw failureError;
      }

      const failure = this.buildFailure(input, printId, template, failureError);
      const target = job.webhooks.failure;
      if (target === undefined) {
        // Without a failure callback the result cannot be delivered; let the
        // queue retry and eventually dead-letter the message.
        this.dependencies.logger.error("print_job_failure_undeliverable", fields);
        throw new DeliveryFailed("no failure callback configured", { cause: failureError });
      }
      await this.dependencies.resultDelivery.deliver(failure, {
        target,
        refId: job.refId,
        messageId,
      });
      this.dependencies.logger.error("print_job_failed", fields);
      return failure;
    }
  }

  private allowedPdfaLevel(job: PrintJob): PdfaLevel | null {
    const pdfA = job.options?.pdfA;
    if (pdfA === undefined || pdfA === false) {
      return null;
    }
    // Never label a standard PDF as archival, even if the renderer could
    // silently ignore an unsupported level.
    if (!this.dependencies.pdfaAllowedLevels.includes(pdfA)) {
      throw new PdfaLevelNotAllowed(`PDF/A level not allowed: ${pdfA}`);
    }
    return pdfA;
  }

  private assertSupportedChannels(job: PrintJob): void {
    this.assertSupportedChannel(job.webhooks.success);
    if (job.webhooks.failure !== undefined) {
      this.assertSupportedChannel(job.webhooks.failure);
    }
  }

  private assertSupportedChannel(target: { readonly channel: CallbackChannel }): void {
    // Reject an unusable callback before doing any rendering or storage work.
    if (!this.dependencies.supportedChannels.includes(target.channel)) {
      throw new CallbackNotAllowed(`unsupported callback channel: ${target.channel}`);
    }
  }

  private async deliverSuccess(
    result: PrintSuccessResult,
    job: PrintJob,
    messageId: string,
  ): Promise<void> {
    try {
      await this.dependencies.resultDelivery.deliver(result, {
        target: job.webhooks.success,
        refId: job.refId,
        messageId,
      });
    } catch (error) {
      if (error instanceof DeliveryFailed) {
        throw error;
      }
      throw new DeliveryFailed(messageFrom(error), { cause: error });
    }
  }

  private buildFailure(
    input: ProcessPrintJobInput,
    printId: string,
    template: TemplateDescriptor | null,
    error: PrintJobError,
  ): PrintFailureResult {
    return {
      success: false,
      printId,
      refId: input.job.refId,
      template: template === null ? null : templateMetadata(template),
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        attempts: input.attempt,
      },
      failedAt: this.dependencies.clock.now().toISOString(),
    };
  }
}

function normalizeProcessingError(error: unknown): PrintJobError {
  if (isPrintJobError(error)) {
    return error;
  }
  // An unclassified adapter failure is treated as transient; the queue's
  // maximum receive count bounds the retries.
  return new PdfRenderFailed(messageFrom(error), { cause: error });
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function templateMetadata(template: TemplateDescriptor): TemplateMetadata {
  return {
    id: template.id,
    slug: template.slug,
    contentHash: template.contentHash,
    release: template.release,
  };
}
