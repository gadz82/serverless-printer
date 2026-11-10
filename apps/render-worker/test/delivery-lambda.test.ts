import type { InvokeCommand } from "@aws-sdk/client-lambda";
import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";
import { describe, expect, it } from "vitest";

import {
  isLambdaFunctionArn,
  LambdaResultDelivery,
  type LambdaInvokeClient,
} from "../src/delivery/lambda-result-delivery.js";
import { context, failureResult, successResult } from "./support/delivery.js";

const FUNCTION_ARN = "arn:aws:lambda:eu-central-1:123456789012:function:printer-callback";

class RecordingLambdaClient implements LambdaInvokeClient {
  readonly commands: InvokeCommand[] = [];

  constructor(
    private readonly handler: () => Promise<{
      readonly StatusCode?: number;
      readonly FunctionError?: string;
    }> = async () => ({ StatusCode: 202 }),
  ) {}

  async send(command: InvokeCommand): Promise<{
    readonly StatusCode?: number;
    readonly FunctionError?: string;
  }> {
    this.commands.push(command);
    return this.handler();
  }
}

function payloadOf(command: InvokeCommand): unknown {
  const payload = command.input.Payload;
  if (!(payload instanceof Uint8Array)) {
    throw new Error("InvokeCommand payload is not bytes");
  }
  return JSON.parse(new TextDecoder().decode(payload));
}

describe("LambdaResultDelivery", () => {
  it("invokes the function asynchronously with the result JSON as the body", async () => {
    const client = new RecordingLambdaClient();
    const delivery = new LambdaResultDelivery(client);

    await delivery.deliver(successResult, context({ channel: "lambda", value: FUNCTION_ARN }));
    await delivery.deliver(failureResult, context({ channel: "lambda", value: FUNCTION_ARN }));

    expect(client.commands).toHaveLength(2);
    expect(client.commands[0]?.input).toMatchObject({
      FunctionName: FUNCTION_ARN,
      InvocationType: "Event",
    });
    expect(payloadOf(client.commands[0]!)).toEqual(successResult);
    expect(payloadOf(client.commands[1]!)).toEqual(failureResult);
  });

  it("maps a FunctionError response to DELIVERY_FAILED", async () => {
    const client = new RecordingLambdaClient(async () => ({
      StatusCode: 202,
      FunctionError: "Unhandled",
    }));

    await expect(
      new LambdaResultDelivery(client).deliver(
        successResult,
        context({ channel: "lambda", value: FUNCTION_ARN }),
      ),
    ).rejects.toBeInstanceOf(DeliveryFailed);
  });

  it("maps a non-2xx response to DELIVERY_FAILED", async () => {
    const client = new RecordingLambdaClient(async () => ({ StatusCode: 500 }));

    await expect(
      new LambdaResultDelivery(client).deliver(
        successResult,
        context({ channel: "lambda", value: FUNCTION_ARN }),
      ),
    ).rejects.toMatchObject({ name: "DeliveryFailed", retryable: true });
  });

  it("wraps SDK failures in DELIVERY_FAILED", async () => {
    const cause = new Error("lambda unavailable");
    const client = new RecordingLambdaClient(async () => Promise.reject(cause));

    await expect(
      new LambdaResultDelivery(client).deliver(
        successResult,
        context({ channel: "lambda", value: FUNCTION_ARN }),
      ),
    ).rejects.toMatchObject({ name: "DeliveryFailed", cause });
  });

  it("rejects an invalid function ARN and a non-lambda channel", async () => {
    const client = new RecordingLambdaClient();
    const delivery = new LambdaResultDelivery(client);

    await expect(
      delivery.deliver(successResult, context({ channel: "lambda", value: "not-an-arn" })),
    ).rejects.toBeInstanceOf(DeliveryFailed);
    await expect(
      delivery.deliver(successResult, context({ channel: "http", value: "https://example.com" })),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(client.commands).toHaveLength(0);
  });

  it("recognizes function ARNs with an optional qualifier", () => {
    expect(isLambdaFunctionArn(FUNCTION_ARN)).toBe(true);
    expect(isLambdaFunctionArn(`${FUNCTION_ARN}:live`)).toBe(true);
    expect(isLambdaFunctionArn("arn:aws:lambda:eu-central-1:123456789012:function:")).toBe(false);
  });
});
