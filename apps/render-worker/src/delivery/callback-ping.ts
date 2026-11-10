import { CallbackNotAllowed } from "@printer/domain";

import type { WorkerLogger } from "../logger.js";
import type { CallbackPolicy } from "../security/index.js";
import {
  HTTP_CALLBACK_TIMEOUT_MS,
  isSuccessStatus,
  type PinnedHttpRequest,
} from "./http-request.js";

export type PreparedPing = {
  readonly url: URL;
  readonly addresses: readonly string[];
};

export type PingLogFields = {
  readonly messageId: string;
  readonly printId?: string;
};

export type CallbackPingOptions = {
  readonly policy: CallbackPolicy;
  readonly request: PinnedHttpRequest;
  readonly logger?: WorkerLogger;
  /** Test seam; production uses the documented 5 s callback timeout. */
  readonly timeoutMs?: number;
};

/**
 * Validates and sends the optional ping that follows a channel delivery.
 *
 * Validation happens before the result is delivered so a disallowed ping URL
 * fails the job without leaking the result. A ping that is allowed but fails
 * at the network level is only logged: delivery already succeeded.
 */
export class CallbackPing {
  private readonly policy: CallbackPolicy;
  private readonly request: PinnedHttpRequest;
  private readonly logger: WorkerLogger | undefined;
  private readonly timeoutMs: number;

  constructor(options: CallbackPingOptions) {
    this.policy = options.policy;
    this.request = options.request;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? HTTP_CALLBACK_TIMEOUT_MS;
  }

  async prepare(rawUrl: string | null | undefined): Promise<PreparedPing | null> {
    if (rawUrl === undefined || rawUrl === null) {
      return null;
    }

    const decision = await this.policy.evaluate(rawUrl);
    if (!decision.allowed) {
      throw new CallbackNotAllowed(decision.message);
    }

    return { url: decision.url, addresses: decision.addresses };
  }

  async send(ping: PreparedPing, success: boolean, fields: PingLogFields): Promise<void> {
    try {
      const response = await this.request({
        url: ping.url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success }),
        addresses: ping.addresses,
        timeoutMs: this.timeoutMs,
      });

      if (!isSuccessStatus(response.status)) {
        throw new Error(`ping returned status ${String(response.status)}`);
      }
    } catch {
      // Never include the ping URL or its response in the log.
      this.logger?.warn("callback_ping_failed", {
        messageId: fields.messageId,
        ...(fields.printId === undefined ? {} : { printId: fields.printId }),
      });
    }
  }
}
