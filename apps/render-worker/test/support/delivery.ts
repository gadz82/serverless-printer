import type { CallbackTarget, DeliveryContext, PrintResult } from "@printer/domain";

import type {
  PinnedHttpRequest,
  PinnedHttpRequestInput,
  PinnedHttpResponse,
} from "../../src/delivery/http-request.js";
import { CallbackPolicy } from "../../src/security/index.js";

export const PUBLIC_ADDRESS = "203.0.113.10";

export const HTTP_URL = "https://callbacks.example.com/print";
export const PING_URL = "https://callbacks.example.com/ping";

export const successResult: PrintResult = {
  success: true,
  printId: "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c",
  refId: "invoice-1",
  printing: "https://prints.example.com/prints/print.pdf?X-Amz-Signature=abc",
  printingExpiresAt: "2026-11-09T10:15:00.000Z",
  sha256: "b".repeat(64),
  sizeBytes: 5,
  pdfA: null,
  template: {
    id: "72803074-1601-4a08-a5a5-49db9feacd66",
    slug: "_smoke",
    contentHash: "c".repeat(64),
    release: "local",
  },
  renderedAt: "2026-11-09T10:00:00.000Z",
};

export const failureResult: PrintResult = {
  success: false,
  printId: "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c",
  refId: "invoice-1",
  template: null,
  error: {
    code: "TEMPLATE_NOT_FOUND",
    message: "template not found: missing",
    retryable: false,
    attempts: 1,
  },
  failedAt: "2026-11-09T10:00:00.000Z",
};

export function context(target: CallbackTarget, messageId = "message-1"): DeliveryContext {
  return {
    target,
    refId: "invoice-1",
    messageId,
  };
}

export function policyFor(
  allowlist: readonly string[],
  addresses: readonly string[] = [PUBLIC_ADDRESS],
  allowLoopback = false,
): CallbackPolicy {
  return new CallbackPolicy({
    allowlist,
    resolver: async () => addresses,
    allowLoopback,
  });
}

export type HttpHandler = (input: PinnedHttpRequestInput) => Promise<PinnedHttpResponse>;

export class RecordingHttpRequest {
  readonly calls: PinnedHttpRequestInput[] = [];

  constructor(private readonly handler: HttpHandler = async () => ({ status: 204 })) {}

  readonly request: PinnedHttpRequest = async (input) => {
    this.calls.push(input);
    return this.handler(input);
  };
}
