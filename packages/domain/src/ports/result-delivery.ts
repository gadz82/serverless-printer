import type { PrintResult } from "../domain/print-result.js";
import type { RefId } from "../domain/ref-id.js";
import type { CallbackTarget } from "../domain/webhooks.js";

export type DeliveryContext = {
  readonly target: CallbackTarget;
  readonly refId: RefId;
  readonly messageId: string;
};

export interface ResultDelivery {
  deliver(result: PrintResult, context: DeliveryContext): Promise<void>;
}
