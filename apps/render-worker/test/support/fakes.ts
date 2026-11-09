import type {
  Clock,
  DeliveryContext,
  IdGenerator,
  PdfRenderer,
  PrintRepository,
  PrintResult,
  ResultDelivery,
  StoredPrint,
  TemplateCatalog,
  TemplateDescriptor,
} from "@printer/domain";
import { DeliveryFailed } from "@printer/domain";
import type { WorkerLogFields, WorkerLogger } from "../../src/logger.js";

export const SMOKE_TEMPLATE: TemplateDescriptor = {
  id: "72803074-1601-4a08-a5a5-49db9feacd66",
  slug: "_smoke",
  contentHash: "0471e548d4a26d54937f991e68b03756f5651215865176bbba3cf996db7ede51",
  release: "local",
  bundlePath: "templates/_smoke",
};

export const PRINT_ID = "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c";

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");

export const STORED_PRINT: StoredPrint = {
  sha256: "b".repeat(64),
  sizeBytes: 19,
  printing: "https://prints.example.com/prints/print.pdf?X-Amz-Signature=example",
  printingExpiresAt: "2026-11-09T10:15:00.000Z",
};

export type LogEntry = {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly fields: WorkerLogFields | undefined;
};

export class CapturingLogger implements WorkerLogger {
  readonly entries: LogEntry[] = [];

  info(event: string, fields?: WorkerLogFields): void {
    this.entries.push({ level: "info", event, fields });
  }

  warn(event: string, fields?: WorkerLogFields): void {
    this.entries.push({ level: "warn", event, fields });
  }

  error(event: string, fields?: WorkerLogFields): void {
    this.entries.push({ level: "error", event, fields });
  }
}

export class InMemoryTemplateCatalog implements TemplateCatalog {
  constructor(private readonly templates: readonly TemplateDescriptor[] = [SMOKE_TEMPLATE]) {}

  async resolve(templateId: string): Promise<TemplateDescriptor | null> {
    return (
      this.templates.find(
        (candidate) => candidate.id === templateId || candidate.slug === templateId,
      ) ?? null
    );
  }
}

export class ScriptedPdfRenderer implements PdfRenderer {
  constructor(private readonly renderer: () => Promise<Uint8Array>) {}

  async render(): Promise<Uint8Array> {
    return this.renderer();
  }
}

export class FixedPrintRepository implements PrintRepository {
  constructor(private readonly storedPrint: StoredPrint = STORED_PRINT) {}

  async store(): Promise<StoredPrint> {
    return this.storedPrint;
  }
}

export type DeliveryRecord = {
  readonly result: PrintResult;
  readonly context: DeliveryContext;
};

export class RecordingResultDelivery implements ResultDelivery {
  readonly deliveries: DeliveryRecord[] = [];

  constructor(private readonly shouldFail: (result: PrintResult) => boolean = () => false) {}

  async deliver(result: PrintResult, context: DeliveryContext): Promise<void> {
    this.deliveries.push({ result, context });
    if (this.shouldFail(result)) {
      throw new DeliveryFailed("forced delivery failure");
    }
  }
}

export class FixedClock implements Clock {
  constructor(private readonly instant: Date = new Date("2026-11-09T10:00:00.000Z")) {}

  now(): Date {
    return new Date(this.instant.getTime());
  }
}

export class FixedIdGenerator implements IdGenerator {
  constructor(private readonly printId: string = PRINT_ID) {}

  forMessage(): string {
    return this.printId;
  }
}
