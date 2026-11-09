import type { IdGenerator } from "@printer/domain";
import { v5 as uuidv5 } from "uuid";

/**
 * Committed UUIDv5 namespace for print ids.
 *
 * Changing it changes every derived printId and breaks caller deduplication.
 */
export const PRINT_ID_NAMESPACE = "6f0e2b7a-8c4d-4a1e-9b3f-2d5c7e9a1b4d";

// ORCHID-MEM: 01a1c1d8-f43a-7c14-886e-0e99b8f3511c — Derives deterministic UUIDv5 print ids from inbound SQS message ids.
export class UuidPrintIdGenerator implements IdGenerator {
  forMessage(messageId: string): string {
    return uuidv5(messageId, PRINT_ID_NAMESPACE);
  }
}
