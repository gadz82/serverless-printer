import { request as httpRequest } from "node:http";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RequestOptions as HttpsRequestOptions } from "node:https";
import { isIP } from "node:net";

export const HTTP_CALLBACK_TIMEOUT_MS = 5_000;

export type PinnedHttpRequestInput = {
  readonly url: URL;
  readonly method: "POST" | "PUT";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  /**
   * Addresses returned by the destination policy. They are tried in order
   * while the timeout budget lasts, so an unreachable IPv6 answer can fall
   * back to IPv4 without a second DNS lookup.
   */
  readonly addresses: readonly string[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
};

export type PinnedHttpResponse = {
  readonly status: number;
};

export type PinnedHttpRequest = (input: PinnedHttpRequestInput) => Promise<PinnedHttpResponse>;

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Sends one HTTP request without following redirects. The caller has already
 * validated the URL and its DNS answers; each attempt connects directly to a
 * validated address while keeping the original host for Host and TLS SNI.
 * Addresses are tried in order inside one overall timeout.
 */
// ORCHID-MEM: 01a1c6e2-7400-7d2c-9d53-5ee417119bae — Pins the validated callback address for HTTP requests without redirects.
export const pinnedHttpRequest: PinnedHttpRequest = async (input) => {
  if (input.addresses.length === 0) {
    throw new Error("callback has no validated address");
  }

  const deadline = Date.now() + input.timeoutMs;
  let lastError: Error | undefined;

  for (let index = 0; index < input.addresses.length; index += 1) {
    const address = input.addresses[index];
    if (address === undefined) {
      continue;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    const attemptsLeft = input.addresses.length - index;
    const attemptTimeoutMs = Math.max(1, Math.floor(remaining / attemptsLeft));

    try {
      return await requestAddress(input, address, attemptTimeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (Date.now() >= deadline) {
    throw new Error(`HTTP callback timed out after ${String(input.timeoutMs)} ms`);
  }

  throw lastError ?? new Error("callback has no validated address");
};

function requestAddress(
  input: PinnedHttpRequestInput,
  address: string,
  timeoutMs: number,
): Promise<PinnedHttpResponse> {
  return new Promise<PinnedHttpResponse>((resolve, reject) => {
    if (input.signal?.aborted === true) {
      reject(abortError(input.signal.reason));
      return;
    }

    const https = input.url.protocol === "https:";
    const options: HttpsRequestOptions = {
      hostname: address,
      port: input.url.port === "" ? undefined : Number(input.url.port),
      path: `${input.url.pathname}${input.url.search}`,
      method: input.method,
      headers: { ...input.headers, Host: input.url.host },
      agent: false,
      // Keep certificate/SNI validation on the validated hostname while the
      // socket itself is pinned to the address above.
      ...(https && isIP(input.url.hostname) === 0 ? { servername: input.url.hostname } : {}),
    };

    let settled = false;
    let request: ClientRequest | undefined;
    const timeout: { timer?: NodeJS.Timeout } = {};

    const cleanup = (): void => {
      if (timeout.timer !== undefined) {
        clearTimeout(timeout.timer);
      }
      input.signal?.removeEventListener("abort", onAbort);
    };

    const finish = (error?: Error, status?: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve({ status: status ?? 0 });
    };

    const onAbort = (): void => {
      request?.destroy(abortError(input.signal?.reason));
    };

    const onResponse = (response: IncomingMessage): void => {
      response.resume();
      finish(undefined, response.statusCode ?? 0);
    };

    input.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      request = https ? httpsRequest(options, onResponse) : httpRequest(options, onResponse);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    timeout.timer = setTimeout(() => {
      request?.destroy(new Error(`HTTP callback timed out after ${String(timeoutMs)} ms`));
    }, timeoutMs);

    request.on("error", (error) => finish(error));
    if (input.body !== undefined) {
      request.write(input.body);
    }
    request.end();
  });
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error("HTTP request aborted");
}
