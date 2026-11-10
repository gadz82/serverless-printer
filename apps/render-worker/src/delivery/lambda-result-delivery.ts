import { InvokeCommand } from "@aws-sdk/client-lambda";
import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";
import type { DeliveryContext, PrintResult, ResultDelivery } from "@printer/domain";

export type LambdaInvokeClient = {
  send(command: InvokeCommand): Promise<{
    readonly StatusCode?: number;
    readonly FunctionError?: string;
  }>;
};

const LAMBDA_FUNCTION_ARN_PATTERN =
  /^arn:(aws[a-z-]*):lambda:([a-z0-9-]+):([0-9]{12}):function:([A-Za-z0-9-_]+)(?::([A-Za-z0-9-_$]+))?$/;

export function isLambdaFunctionArn(value: string): boolean {
  return LAMBDA_FUNCTION_ARN_PATTERN.test(value);
}

/**
 * Invokes the caller's Lambda asynchronously. The result JSON is the payload;
 * the callback function owns its own retry and dead-letter policy.
 */
export class LambdaResultDelivery implements ResultDelivery {
  constructor(private readonly client: LambdaInvokeClient) {}

  async deliver(result: PrintResult, context: DeliveryContext): Promise<void> {
    if (context.target.channel !== "lambda") {
      throw new CallbackNotAllowed(`unsupported callback channel: ${context.target.channel}`);
    }
    if (!isLambdaFunctionArn(context.target.value)) {
      throw new DeliveryFailed("callback target is not a valid Lambda function ARN");
    }

    try {
      const response = await this.client.send(
        new InvokeCommand({
          FunctionName: context.target.value,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(JSON.stringify(result)),
        }),
      );

      if (response.FunctionError !== undefined) {
        throw new DeliveryFailed("Lambda callback returned a function error");
      }
      if (
        response.StatusCode !== undefined &&
        (response.StatusCode < 200 || response.StatusCode >= 300)
      ) {
        throw new DeliveryFailed(`Lambda callback returned status ${String(response.StatusCode)}`);
      }
    } catch (error) {
      if (error instanceof DeliveryFailed) {
        throw error;
      }
      throw new DeliveryFailed("failed to deliver result to Lambda", { cause: error });
    }
  }
}
