import type { PrintOptions } from "./print-options.js";
import type { RefId } from "./ref-id.js";
import type { Webhooks } from "./webhooks.js";

/**
 * A job that already passed the public contract.
 *
 * Transport types, raw JSON and validation errors stay at the adapter boundary;
 * the use case only consumes this validated shape.
 */
export type PrintJob = {
  readonly templateId: string;
  readonly refId: RefId;
  readonly options?: PrintOptions;
  readonly webhooks: Webhooks;
  readonly payload?: Readonly<Record<string, unknown>>;
};
