import type { ErrorCode } from "../domain/errors.js";

/**
 * Log fields are an allowlist: payloads, HTML, PDF bytes and refId are
 * deliberately absent because they may contain caller data.
 */
export type LogFields = {
  readonly messageId?: string;
  readonly printId?: string;
  readonly templateId?: string;
  readonly attempt?: number;
  readonly errorCode?: ErrorCode;
};

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}
