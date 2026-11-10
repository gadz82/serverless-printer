import type {
  CallbackTarget,
  CallbackTargetValidator,
  Clock,
  DeliverPdfInput,
  DeliveredPdf,
  DeliveryContext,
  IdGenerator,
  LogFields,
  Logger,
  PdfArchiveOptions,
  PdfArchiver,
  PdfDestination,
  PdfRenderer,
  PrintRepository,
  PrintResult,
  RenderPdfInput,
  ResultDelivery,
  StoredPrint,
  StorePrintInput,
  TemplateCatalog,
  TemplateDescriptor,
} from "../../src/index.js";

export const template: TemplateDescriptor = {
  id: "6f1c2b0e-8a4d-4f7e-9c1a-2d3b4e5f6a7b",
  slug: "annual-statement",
  contentHash: "a".repeat(64),
  release: "v1.4.0",
  bundlePath: "templates/annual-statement",
};

export const storedPrint: StoredPrint = {
  sha256: "b".repeat(64),
  sizeBytes: 48211,
  printing:
    "https://printer-prints.s3.eu-central-1.amazonaws.com/prints/print.pdf?X-Amz-Signature=example",
  printingExpiresAt: "2026-11-09T10:15:00.000Z",
};

export const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
export const ARCHIVED_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

export const deliveredPdf: DeliveredPdf = {
  sha256: "d".repeat(64),
  sizeBytes: PDF_BYTES.byteLength,
};

export type RenderHandler = (input: RenderPdfInput) => Promise<Uint8Array>;
export type ArchiveHandler = (
  pdfBytes: Uint8Array,
  options: PdfArchiveOptions,
) => Promise<Uint8Array>;
export type StoreHandler = (input: StorePrintInput) => Promise<StoredPrint>;

export type DeliveryRecord = {
  readonly result: PrintResult;
  readonly context: DeliveryContext;
};

export type DeliveryHandler = (delivery: DeliveryRecord) => Promise<void>;
export type DeliverPdfHandler = (input: DeliverPdfInput) => Promise<DeliveredPdf>;
export type CallbackValidatorHandler = (target: CallbackTarget) => Promise<void>;

export class FakeCallbackValidator implements CallbackTargetValidator {
  readonly targets: CallbackTarget[] = [];

  constructor(private readonly handler: CallbackValidatorHandler = async () => undefined) {}

  async assertTargetAllowed(target: CallbackTarget): Promise<void> {
    this.targets.push(target);
    await this.handler(target);
  }
}

export class InMemoryTemplateCatalog implements TemplateCatalog {
  readonly requested: string[] = [];

  constructor(private readonly templates: readonly TemplateDescriptor[] = [template]) {}

  async resolve(templateId: string): Promise<TemplateDescriptor | null> {
    this.requested.push(templateId);
    return (
      this.templates.find(
        (candidate) => candidate.id === templateId || candidate.slug === templateId,
      ) ?? null
    );
  }
}

export class FakePdfRenderer implements PdfRenderer {
  readonly calls: RenderPdfInput[] = [];

  constructor(private readonly handler: RenderHandler = async () => PDF_BYTES) {}

  async render(input: RenderPdfInput): Promise<Uint8Array> {
    this.calls.push(input);
    return this.handler(input);
  }
}

export class FakePdfArchiver implements PdfArchiver {
  readonly calls: PdfArchiveOptions[] = [];

  constructor(private readonly handler: ArchiveHandler = async () => ARCHIVED_PDF_BYTES) {}

  async archive(pdfBytes: Uint8Array, options: PdfArchiveOptions): Promise<Uint8Array> {
    this.calls.push(options);
    return this.handler(pdfBytes, options);
  }
}

export class FakePdfDestination implements PdfDestination {
  readonly calls: DeliverPdfInput[] = [];

  constructor(private readonly handler: DeliverPdfHandler = async () => deliveredPdf) {}

  async deliverPdf(input: DeliverPdfInput): Promise<DeliveredPdf> {
    this.calls.push(input);
    return this.handler(input);
  }
}

export class FakePrintRepository implements PrintRepository {
  readonly calls: StorePrintInput[] = [];

  constructor(private readonly handler: StoreHandler = async () => storedPrint) {}

  async store(input: StorePrintInput): Promise<StoredPrint> {
    this.calls.push(input);
    return this.handler(input);
  }
}

export class FakeResultDelivery implements ResultDelivery {
  readonly deliveries: DeliveryRecord[] = [];

  constructor(private readonly handler: DeliveryHandler = () => Promise.resolve()) {}

  async deliver(result: PrintResult, context: DeliveryContext): Promise<void> {
    const delivery = { result, context };
    this.deliveries.push(delivery);
    await this.handler(delivery);
  }
}

export class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant.getTime());
  }
}

export class FakeIdGenerator implements IdGenerator {
  readonly calls: string[] = [];

  forMessage(messageId: string): string {
    this.calls.push(messageId);
    return `print-${messageId}`;
  }
}

export type LogEntry = {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
};

export class FakeLogger implements Logger {
  readonly entries: LogEntry[] = [];

  info(event: string, fields?: LogFields): void {
    this.entries.push({ level: "info", event, fields });
  }

  warn(event: string, fields?: LogFields): void {
    this.entries.push({ level: "warn", event, fields });
  }

  error(event: string, fields?: LogFields): void {
    this.entries.push({ level: "error", event, fields });
  }
}
