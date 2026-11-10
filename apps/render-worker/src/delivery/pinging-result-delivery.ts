import type { DeliveryContext, PrintResult, ResultDelivery } from "@printer/domain";

import type { CallbackPing } from "./callback-ping.js";

/**
 * Adds the post-delivery ping to any ResultDelivery adapter.
 *
 * The ping URL is policy-checked before the result is delivered; a network or
 * status failure after delivery is logged by CallbackPing and never turns a
 * delivered result into a retryable failure.
 */
export class PingingResultDelivery implements ResultDelivery {
  constructor(
    private readonly delivery: ResultDelivery,
    private readonly pings: CallbackPing,
  ) {}

  async deliver(result: PrintResult, context: DeliveryContext): Promise<void> {
    const ping = await this.pings.prepare(context.target.pingUrl);
    await this.delivery.deliver(result, context);

    if (ping !== null) {
      await this.pings.send(ping, result.success, {
        messageId: context.messageId,
        printId: result.printId,
      });
    }
  }
}
