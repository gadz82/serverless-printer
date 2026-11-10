import type { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";
import { describe, expect, it } from "vitest";

import {
  EventBridgeResultDelivery,
  isEventBusArn,
  resultDetailType,
  type EventBridgePutEventsClient,
} from "../src/delivery/eventbridge-result-delivery.js";
import { context, failureResult, successResult } from "./support/delivery.js";

const BUS_ARN = "arn:aws:events:eu-central-1:123456789012:event-bus/printer-callbacks";

class RecordingEventBridgeClient implements EventBridgePutEventsClient {
  readonly commands: PutEventsCommand[] = [];

  constructor(
    private readonly handler: () => Promise<{
      readonly FailedEntryCount?: number;
      readonly Entries?: readonly { readonly ErrorCode?: string }[];
    }> = async () => ({ FailedEntryCount: 0, Entries: [{}] }),
  ) {}

  async send(command: PutEventsCommand): Promise<{
    readonly FailedEntryCount?: number;
    readonly Entries?: readonly { readonly ErrorCode?: string }[];
  }> {
    this.commands.push(command);
    return this.handler();
  }
}

describe("EventBridgeResultDelivery", () => {
  it("publishes the result with EVENT_SOURCE and the success detail type", async () => {
    const client = new RecordingEventBridgeClient();
    const delivery = new EventBridgeResultDelivery(client, "printer-test");

    await delivery.deliver(successResult, context({ channel: "eventBridge", value: BUS_ARN }));

    expect(client.commands[0]?.input.Entries).toEqual([
      {
        EventBusName: BUS_ARN,
        Source: "printer-test",
        DetailType: "printer.print.succeeded",
        Detail: JSON.stringify(successResult),
      },
    ]);
  });

  it("uses the failure detail type for a failure result", async () => {
    const client = new RecordingEventBridgeClient();
    const delivery = new EventBridgeResultDelivery(client, "printer");

    await delivery.deliver(failureResult, context({ channel: "eventBridge", value: BUS_ARN }));

    expect(client.commands[0]?.input.Entries?.[0]?.DetailType).toBe("printer.print.failed");
    expect(client.commands[0]?.input.Entries?.[0]?.Detail).toBe(JSON.stringify(failureResult));
  });

  it("maps a failed entry to DELIVERY_FAILED", async () => {
    const client = new RecordingEventBridgeClient(async () => ({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: "InternalFailure" }],
    }));

    await expect(
      new EventBridgeResultDelivery(client, "printer").deliver(
        successResult,
        context({ channel: "eventBridge", value: BUS_ARN }),
      ),
    ).rejects.toBeInstanceOf(DeliveryFailed);
  });

  it("wraps SDK failures in DELIVERY_FAILED", async () => {
    const cause = new Error("events unavailable");
    const client = new RecordingEventBridgeClient(async () => Promise.reject(cause));

    await expect(
      new EventBridgeResultDelivery(client, "printer").deliver(
        successResult,
        context({ channel: "eventBridge", value: BUS_ARN }),
      ),
    ).rejects.toMatchObject({ name: "DeliveryFailed", cause });
  });

  it("rejects an invalid bus ARN and a non-eventBridge channel", async () => {
    const client = new RecordingEventBridgeClient();
    const delivery = new EventBridgeResultDelivery(client, "printer");

    await expect(
      delivery.deliver(successResult, context({ channel: "eventBridge", value: "not-an-arn" })),
    ).rejects.toBeInstanceOf(DeliveryFailed);
    await expect(
      delivery.deliver(successResult, context({ channel: "http", value: "https://example.com" })),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(client.commands).toHaveLength(0);
  });

  it("recognizes event bus ARNs and maps detail types", () => {
    expect(isEventBusArn(BUS_ARN)).toBe(true);
    expect(isEventBusArn("arn:aws:events:eu-central-1:123456789012:event-bus/default")).toBe(true);
    expect(isEventBusArn("arn:aws:events:eu-central-1:123456789012:rule/x")).toBe(false);
    expect(resultDetailType(successResult)).toBe("printer.print.succeeded");
    expect(resultDetailType(failureResult)).toBe("printer.print.failed");
  });
});
