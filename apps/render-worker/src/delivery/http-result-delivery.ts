import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";
import type { DeliveryContext, PrintResult, ResultDelivery } from "@printer/domain";

import type { CallbackPolicy } from "../security/index.js";
import {
  HTTP_CALLBACK_TIMEOUT_MS,
  isSuccessStatus,
  type PinnedHttpRequest,
} from "./http-request.js";

export type HttpResultDeliveryOptions = {
  readonly policy: CallbackPolicy;
  readonly request: PinnedHttpRequest;
  /** Test seam; production uses the documented 5 s callback timeout. */
  readonly timeoutMs?: number;
};

/**
 * Delivers the JSON result to an allowlisted HTTP endpoint.
 *
 * The policy is evaluated immediately before every request and its resolved
 * addresses are pinned by the request adapter. Redirects are never followed,
 * so a 3xx response is a delivery failure rather than a second hop.
 */
export class HttpResultDelivery implements ResultDelivery {
  private readonly policy: CallbackPolicy;
  private readonly request: PinnedHttpRequest;
  private readonly timeoutMs: number;

  constructor(options: HttpResultDeliveryOptions) {
    this.policy = options.policy;
    this.request = options.request;
    this.timeoutMs = options.timeoutMs ?? HTTP_CALLBACK_TIMEOUT_MS;
  }

  async deliver(result: PrintResult, context: DeliveryContext): Promise<void> {
    if (context.target.channel !== "http") {
      throw new CallbackNotAllowed(`unsupported callback channel: ${context.target.channel}`);
    }

    const decision = await this.policy.evaluate(context.target.value);
    if (!decision.allowed) {
      throw new CallbackNotAllowed(decision.message);
    }

    let response;
    try {
      response = await this.request({
        url: decision.url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Printer-Print-Id": result.printId,
        },
        body: JSON.stringify(result),
        addresses: decision.addresses,
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      throw new DeliveryFailed("failed to deliver result over HTTP", { cause: error });
    }

    if (!isSuccessStatus(response.status)) {
      throw new DeliveryFailed(`HTTP callback returned status ${String(response.status)}`);
    }
  }
}
