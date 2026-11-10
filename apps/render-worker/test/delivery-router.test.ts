import type { SendMessageCommand } from "@aws-sdk/client-sqs";
import { CallbackNotAllowed } from "@printer/domain";
import { describe, expect, it } from "vitest";

import { SqsResultDelivery, type SqsSendClient } from "../src/adapters/sqs-result-delivery.js";
import { CallbackPing } from "../src/delivery/callback-ping.js";
import { PingingResultDelivery } from "../src/delivery/pinging-result-delivery.js";
import { ResultDeliveryRouter } from "../src/delivery/result-delivery-router.js";
import { CapturingLogger } from "./support/fakes.js";
import {
  PING_URL,
  RecordingHttpRequest,
  context,
  failureResult,
  policyFor,
  successResult,
} from "./support/delivery.js";

const FIFO_ARN = "arn:aws:sqs:eu-central-1:123456789012:printer-results.fifo";

class RecordingSqsClient implements SqsSendClient {
  readonly commands: SendMessageCommand[] = [];

  constructor(private readonly failure?: Error) {}

  async send(command: SendMessageCommand): Promise<unknown> {
    this.commands.push(command);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return { MessageId: "outbound-1" };
  }
}

describe("ResultDeliveryRouter", () => {
  it("dispatches to the adapter for the target channel", async () => {
    const client = new RecordingSqsClient();
    const router = new ResultDeliveryRouter({ sqs: new SqsResultDelivery(client) });

    await router.deliver(successResult, context({ channel: "sqs", value: FIFO_ARN }));

    expect(client.commands).toHaveLength(1);
    expect(client.commands[0]?.input.QueueUrl).toContain("printer-results.fifo");
  });

  it("rejects a channel without an adapter with CALLBACK_NOT_ALLOWED", async () => {
    const router = new ResultDeliveryRouter({});

    await expect(
      router.deliver(successResult, context({ channel: "s3", value: "https://example.com/put" })),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
  });
});

describe("PingingResultDelivery over SQS", () => {
  function setup(options: {
    readonly sqsFailure?: Error;
    readonly pingRequest: RecordingHttpRequest;
    readonly logger?: CapturingLogger;
  }) {
    const client = new RecordingSqsClient(options.sqsFailure);
    const policy = policyFor(["https://callbacks.example.com"]);
    return {
      client,
      delivery: new PingingResultDelivery(
        new SqsResultDelivery(client),
        new CallbackPing({
          policy,
          request: options.pingRequest.request,
          ...(options.logger === undefined ? {} : { logger: options.logger }),
        }),
      ),
    };
  }

  it("keeps the FIFO identifiers and pings after the message is sent", async () => {
    const events: string[] = [];
    const client = new RecordingSqsClient();
    const originalSend = client.send.bind(client);
    client.send = async (command) => {
      events.push("sqs");
      return originalSend(command);
    };
    const pingRequest = new RecordingHttpRequest(async () => {
      events.push("ping");
      return { status: 204 };
    });
    const policy = policyFor(["https://callbacks.example.com"]);
    const delivery = new PingingResultDelivery(
      new SqsResultDelivery(client),
      new CallbackPing({ policy, request: pingRequest.request }),
    );

    await delivery.deliver(
      successResult,
      context({ channel: "sqs", value: FIFO_ARN, pingUrl: PING_URL }),
    );

    expect(events).toEqual(["sqs", "ping"]);
    expect(client.commands[0]?.input).toMatchObject({
      MessageGroupId: "invoice-1",
      MessageDeduplicationId: expect.any(String),
    });
  });

  it("sends a false ping for a failure result", async () => {
    const pingRequest = new RecordingHttpRequest();
    const { delivery } = setup({ pingRequest });

    await delivery.deliver(
      failureResult,
      context({ channel: "sqs", value: FIFO_ARN, pingUrl: PING_URL }),
    );

    expect(pingRequest.calls[0]?.body).toBe('{"success":false}');
  });

  it("does not ping when the channel delivery fails", async () => {
    const pingRequest = new RecordingHttpRequest();
    const { delivery } = setup({
      pingRequest,
      sqsFailure: new Error("sqs down"),
    });

    await expect(
      delivery.deliver(
        successResult,
        context({ channel: "sqs", value: FIFO_ARN, pingUrl: PING_URL }),
      ),
    ).rejects.toMatchObject({ name: "DeliveryFailed" });
    expect(pingRequest.calls).toHaveLength(0);
  });

  it("rejects a disallowed ping URL before sending the message", async () => {
    const pingRequest = new RecordingHttpRequest();
    const { client, delivery } = setup({ pingRequest });

    await expect(
      delivery.deliver(
        successResult,
        context({
          channel: "sqs",
          value: FIFO_ARN,
          pingUrl: "https://unlisted.example.com/ping",
        }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(client.commands).toHaveLength(0);
  });

  it("logs a failed ping without failing the SQS delivery", async () => {
    const logger = new CapturingLogger();
    const pingRequest = new RecordingHttpRequest(async () => ({ status: 503 }));
    const { delivery } = setup({ pingRequest, logger });

    await expect(
      delivery.deliver(
        successResult,
        context({ channel: "sqs", value: FIFO_ARN, pingUrl: PING_URL }),
      ),
    ).resolves.toBeUndefined();
    expect(logger.entries[0]).toMatchObject({ event: "callback_ping_failed" });
  });
});
