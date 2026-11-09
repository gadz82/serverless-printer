import type { LogFields, Logger } from "@printer/domain";

/**
 * The worker logger accepts only the domain log allowlist plus a duration.
 * Payloads, refId, rendered HTML and PDF bytes are deliberately unrepresentable.
 */
export type WorkerLogFields = LogFields & {
  readonly durationMs?: number;
};

export interface WorkerLogger extends Logger {
  info(event: string, fields?: WorkerLogFields): void;
  warn(event: string, fields?: WorkerLogFields): void;
  error(event: string, fields?: WorkerLogFields): void;
}

export type LogSink = {
  log(message: string): void;
};

type LogEntry = {
  level: "info" | "warn" | "error";
  event: string;
  timestamp: string;
  messageId?: string;
  printId?: string;
  templateId?: string;
  attempt?: number;
  errorCode?: string;
  durationMs?: number;
};

/**
 * Emits one JSON object per line and copies only allowlisted fields from the
 * caller, so an accidental extra property cannot leak caller data.
 */
export class JsonLogger implements WorkerLogger {
  constructor(
    private readonly sink: LogSink = console,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  info(event: string, fields?: WorkerLogFields): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields?: WorkerLogFields): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields?: WorkerLogFields): void {
    this.write("error", event, fields);
  }

  private write(level: LogEntry["level"], event: string, fields?: WorkerLogFields): void {
    const entry: LogEntry = {
      level,
      event,
      timestamp: this.clock().toISOString(),
    };

    if (fields?.messageId !== undefined) {
      entry.messageId = fields.messageId;
    }
    if (fields?.printId !== undefined) {
      entry.printId = fields.printId;
    }
    if (fields?.templateId !== undefined) {
      entry.templateId = fields.templateId;
    }
    if (fields?.attempt !== undefined) {
      entry.attempt = fields.attempt;
    }
    if (fields?.errorCode !== undefined) {
      entry.errorCode = fields.errorCode;
    }
    if (fields?.durationMs !== undefined) {
      entry.durationMs = fields.durationMs;
    }

    this.sink.log(JSON.stringify(entry));
  }
}
