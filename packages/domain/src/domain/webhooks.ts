export type CallbackChannel = "http" | "lambda" | "sqs" | "eventBridge" | "s3";

export type CallbackTarget = {
  readonly channel: CallbackChannel;
  readonly value: string;
  readonly pingUrl?: string | null;
};

export type Webhooks = {
  readonly success: CallbackTarget;
  readonly failure?: CallbackTarget;
};
