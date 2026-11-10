import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";
import { describe, expect, it } from "vitest";

import { CallbackPing } from "../src/delivery/callback-ping.js";
import { HttpResultDelivery } from "../src/delivery/http-result-delivery.js";
import { HTTP_CALLBACK_TIMEOUT_MS, pinnedHttpRequest } from "../src/delivery/http-request.js";
import { PingingResultDelivery } from "../src/delivery/pinging-result-delivery.js";
import { CapturingLogger } from "./support/fakes.js";
import {
  HTTP_URL,
  PING_URL,
  RecordingHttpRequest,
  context,
  failureResult,
  policyFor,
  successResult,
} from "./support/delivery.js";

function delivery(options: { readonly request: RecordingHttpRequest["request"] }) {
  return new HttpResultDelivery({
    policy: policyFor(["https://callbacks.example.com"]),
    request: options.request,
  });
}

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ readonly server: ReturnType<typeof createServer>; readonly port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, port: address.port };
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("HttpResultDelivery", () => {
  it("POSTs JSON with X-Printer-Print-Id, the pinned address and a 5 s timeout", async () => {
    const recorder = new RecordingHttpRequest();
    const target = { channel: "http" as const, value: HTTP_URL };

    await delivery({ request: recorder.request }).deliver(successResult, context(target));

    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toEqual({
      url: new URL(HTTP_URL),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Printer-Print-Id": successResult.printId,
      },
      body: JSON.stringify(successResult),
      addresses: ["203.0.113.10"],
      timeoutMs: HTTP_CALLBACK_TIMEOUT_MS,
    });
  });

  it("accepts any 2xx response", async () => {
    const recorder = new RecordingHttpRequest(async () => ({ status: 299 }));

    await expect(
      delivery({ request: recorder.request }).deliver(
        successResult,
        context({
          channel: "http",
          value: HTTP_URL,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([300, 302, 400, 500])("rejects a %s response as DELIVERY_FAILED", async (status) => {
    const recorder = new RecordingHttpRequest(async () => ({ status }));

    await expect(
      delivery({ request: recorder.request }).deliver(
        successResult,
        context({
          channel: "http",
          value: HTTP_URL,
        }),
      ),
    ).rejects.toMatchObject({
      name: "DeliveryFailed",
      code: "DELIVERY_FAILED",
      retryable: true,
    });
  });

  it("rejects a target outside the policy before sending any request", async () => {
    const recorder = new RecordingHttpRequest();

    await expect(
      delivery({ request: recorder.request }).deliver(
        successResult,
        context({
          channel: "http",
          value: "https://unlisted.example.com/print",
        }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(recorder.calls).toHaveLength(0);
  });

  it("wraps a transport failure in the retryable DELIVERY_FAILED error", async () => {
    const cause = new Error("connection reset");
    const recorder = new RecordingHttpRequest(async () => Promise.reject(cause));

    await expect(
      delivery({ request: recorder.request }).deliver(
        successResult,
        context({
          channel: "http",
          value: HTTP_URL,
        }),
      ),
    ).rejects.toMatchObject({
      name: "DeliveryFailed",
      retryable: true,
      cause,
    });
  });
});

describe("HTTP ping", () => {
  function pingingDelivery(recorder: RecordingHttpRequest, logger?: CapturingLogger) {
    const policy = policyFor(["https://callbacks.example.com"]);
    return new PingingResultDelivery(
      new HttpResultDelivery({ policy, request: recorder.request }),
      new CallbackPing({
        policy,
        request: recorder.request,
        ...(logger === undefined ? {} : { logger }),
      }),
    );
  }

  it("pings after the result with the documented success flag", async () => {
    const recorder = new RecordingHttpRequest();
    const target = { channel: "http" as const, value: HTTP_URL, pingUrl: PING_URL };

    await pingingDelivery(recorder).deliver(successResult, context(target));
    await pingingDelivery(recorder).deliver(failureResult, context(target));

    expect(recorder.calls).toHaveLength(4);
    expect(recorder.calls[0]?.url).toEqual(new URL(HTTP_URL));
    expect(recorder.calls[1]?.url).toEqual(new URL(PING_URL));
    expect(recorder.calls[1]?.body).toBe('{"success":true}');
    expect(recorder.calls[1]?.headers).toEqual({ "Content-Type": "application/json" });
    expect(recorder.calls[3]?.body).toBe('{"success":false}');
  });

  it("checks the ping URL before delivering the result", async () => {
    const recorder = new RecordingHttpRequest();

    await expect(
      pingingDelivery(recorder).deliver(
        successResult,
        context({
          channel: "http",
          value: HTTP_URL,
          pingUrl: "https://unlisted.example.com/ping",
        }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(recorder.calls).toHaveLength(0);
  });

  it("logs a failed ping without failing the delivered result", async () => {
    const logger = new CapturingLogger();
    const recorder = new RecordingHttpRequest(async (input) =>
      input.url.pathname === "/ping" ? { status: 500 } : { status: 204 },
    );
    const target = { channel: "http" as const, value: HTTP_URL, pingUrl: PING_URL };

    await expect(
      pingingDelivery(recorder, logger).deliver(successResult, context(target)),
    ).resolves.toBeUndefined();

    expect(recorder.calls).toHaveLength(2);
    expect(logger.entries).toEqual([
      {
        level: "warn",
        event: "callback_ping_failed",
        fields: {
          messageId: "message-1",
          printId: successResult.printId,
        },
      },
    ]);
  });
});

describe("pinned HTTP requests", () => {
  it("connects to the validated address with the original Host and does not follow redirects", async () => {
    const received: { host: string | undefined; path: string | undefined }[] = [];
    const { server, port } = await startServer((request, response) => {
      received.push({ host: request.headers.host, path: request.url });
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/followed" });
        response.end();
        return;
      }
      response.writeHead(204);
      response.end();
    });

    try {
      const policy = policyFor(
        [`http://callbacks.example.com:${String(port)}`],
        ["127.0.0.1"],
        true,
      );
      const http = new HttpResultDelivery({ policy, request: pinnedHttpRequest });

      await expect(
        http.deliver(
          successResult,
          context({
            channel: "http",
            value: `http://callbacks.example.com:${String(port)}/print`,
          }),
        ),
      ).resolves.toBeUndefined();
      expect(received).toEqual([{ host: `callbacks.example.com:${String(port)}`, path: "/print" }]);

      await expect(
        http.deliver(
          successResult,
          context({
            channel: "http",
            value: `http://callbacks.example.com:${String(port)}/redirect`,
          }),
        ),
      ).rejects.toBeInstanceOf(DeliveryFailed);
      expect(received.map((entry) => entry.path)).toEqual(["/print", "/redirect"]);
    } finally {
      await closeServer(server);
    }
  });

  it("falls back to the next validated address within the timeout budget", async () => {
    const received: string[] = [];
    const { server, port } = await startServer((request, response) => {
      received.push(request.url ?? "");
      response.writeHead(204);
      response.end();
    });

    try {
      const result = await pinnedHttpRequest({
        url: new URL(`http://callbacks.example.com:${String(port)}/print`),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        addresses: ["::1", "127.0.0.1"],
        timeoutMs: 2_000,
      });

      expect(result.status).toBe(204);
      expect(received).toEqual(["/print"]);
    } finally {
      await closeServer(server);
    }
  });

  it("times out a request that never responds", async () => {
    const { server, port } = await startServer(() => undefined);

    try {
      const policy = policyFor(
        [`http://callbacks.example.com:${String(port)}`],
        ["127.0.0.1"],
        true,
      );
      const http = new HttpResultDelivery({ policy, request: pinnedHttpRequest, timeoutMs: 25 });

      await expect(
        http.deliver(
          successResult,
          context({
            channel: "http",
            value: `http://callbacks.example.com:${String(port)}/slow`,
          }),
        ),
      ).rejects.toMatchObject({
        name: "DeliveryFailed",
        cause: expect.objectContaining({ message: expect.stringContaining("timed out") }),
      });
    } finally {
      await closeServer(server);
    }
  });
});
