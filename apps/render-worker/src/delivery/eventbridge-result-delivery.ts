import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";
import type { DeliveryContext, PrintResult, ResultDelivery } from "@printer/domain";

export type EventBridgePutEventsClient = {
  send(command: PutEventsCommand): Promise<{
    readonly FailedEntryCount?: number;
    readonly Entries?: readonly { readonly ErrorCode?: string }[];
  }>;
};

const EVENT_BUS_ARN_PATTERN =
  /^arn:(aws[a-z-]*):events:([a-z0-9-]+):([0-9]{12}):event-bus\/[A-Za-z0-9._/-]+$/;

export function isEventBusArn(value: string): boolean {
  return EVENT_BUS_ARN_PATTERN.test(value);
}

export function resultDetailType(result: PrintResult): string {
  return result.success ? "printer.print.succeeded" : "printer.print.failed";
}

/**
 * Publishes the result as one EventBridge event on the caller's bus ARN.
 * `Source` is the configured EVENT_SOURCE and the detail type declares whether
 * the job succeeded or failed.
 */
export class EventBridgeResultDelivery implements ResultDelivery {
  constructor(
    private readonly client: EventBridgePutEventsClient,
    private readonly eventSource: string,
  ) {}

  async deliver(result: PrintResult, context: DeliveryContext): Promise<void> {
    if (context.target.channel !== "eventBridge") {
      throw new CallbackNotAllowed(`unsupported callback channel: ${context.target.channel}`);
    }
    if (!isEventBusArn(context.target.value)) {
      throw new DeliveryFailed("callback target is not a valid EventBridge bus ARN");
    }

    try {
      const response = await this.client.send(
        new PutEventsCommand({
          Entries: [
            {
              EventBusName: context.target.value,
              Source: this.eventSource,
              DetailType: resultDetailType(result),
              Detail: JSON.stringify(result),
            },
          ],
        }),
      );

      const failedEntries =
        response.Entries?.filter((entry) => entry.ErrorCode !== undefined).length ?? 0;
      if ((response.FailedEntryCount ?? 0) > 0 || failedEntries > 0) {
        throw new DeliveryFailed("EventBridge rejected the callback event");
      }
    } catch (error) {
      if (error instanceof DeliveryFailed) {
        throw error;
      }
      throw new DeliveryFailed("failed to deliver result to EventBridge", { cause: error });
    }
  }
}
