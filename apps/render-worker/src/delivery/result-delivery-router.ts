import { CallbackNotAllowed } from "@printer/domain";
import type {
  CallbackChannel,
  DeliveryContext,
  PrintResult,
  ResultDelivery,
} from "@printer/domain";

export type ChannelDeliveries = Partial<Record<CallbackChannel, ResultDelivery>>;

/**
 * Selects the adapter for a callback channel. The s3 channel is absent by
 * design: its PDF bytes travel through the PdfDestination capability, not the
 * JSON ResultDelivery port.
 */
// ORCHID-MEM: 01a1c6e2-742e-7487-90c5-d6432db771cf — Routes the five result channels and optional callback ping through one adapter.
export class ResultDeliveryRouter implements ResultDelivery {
  constructor(private readonly deliveries: ChannelDeliveries) {}

  async deliver(result: PrintResult, context: DeliveryContext): Promise<void> {
    const delivery = this.deliveries[context.target.channel];
    if (delivery === undefined) {
      throw new CallbackNotAllowed(`unsupported callback channel: ${context.target.channel}`);
    }

    await delivery.deliver(result, context);
  }
}
