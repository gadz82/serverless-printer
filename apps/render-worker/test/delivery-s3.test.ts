import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { CallbackNotAllowed } from "@printer/domain";
import { describe, expect, it } from "vitest";

import { CallbackPing } from "../src/delivery/callback-ping.js";
import {
  pinnedHttpRequest,
  type PinnedHttpRequest,
  type PinnedHttpRequestInput,
} from "../src/delivery/http-request.js";
import {
  S3_UPLOAD_TIMEOUT_MS,
  S3PdfDestination,
  type S3DnsResolver,
} from "../src/delivery/s3-pdf-destination.js";
import { CapturingLogger } from "./support/fakes.js";
import {
  PING_URL,
  PUBLIC_ADDRESS,
  RecordingHttpRequest,
  policyFor,
  successResult,
} from "./support/delivery.js";

const PRESIGNED_URL = "https://printer-output.s3.amazonaws.com/upload?X-Amz-Signature=abc";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

class RecordingS3Request {
  readonly calls: PinnedHttpRequestInput[] = [];

  constructor(
    private readonly handler: (
      input: PinnedHttpRequestInput,
    ) => Promise<{ status: number }> = async () => ({ status: 200 }),
  ) {}

  readonly request: PinnedHttpRequest = async (input) => {
    this.calls.push(input);
    return this.handler(input);
  };
}

function setup(options: {
  readonly request: PinnedHttpRequest;
  readonly pingRequest?: RecordingHttpRequest;
  readonly logger?: CapturingLogger;
  readonly resolve?: S3DnsResolver;
  readonly allowPrivateEndpoint?: boolean;
}) {
  const pingRequest = options.pingRequest ?? new RecordingHttpRequest();
  const pings = new CallbackPing({
    policy: policyFor(["https://callbacks.example.com"]),
    request: pingRequest.request,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return {
    destination: new S3PdfDestination({
      pings,
      request: options.request,
      resolve: options.resolve ?? (async () => [PUBLIC_ADDRESS]),
      ...(options.allowPrivateEndpoint === undefined
        ? {}
        : { allowPrivateEndpoint: options.allowPrivateEndpoint }),
    }),
    pingRequest,
  };
}

function input(overrides: Partial<Parameters<S3PdfDestination["deliverPdf"]>[0]> = {}) {
  return {
    target: { channel: "s3" as const, value: PRESIGNED_URL },
    printId: successResult.printId,
    messageId: "message-1",
    pdfBytes: PDF_BYTES,
    ...overrides,
  };
}

describe("S3PdfDestination", () => {
  it("PUTs the PDF through the pinned transport with the validated address", async () => {
    const recorder = new RecordingS3Request();
    const { destination } = setup({ request: recorder.request });

    const delivered = await destination.deliverPdf(input());

    expect(recorder.calls).toHaveLength(1);
    const call = recorder.calls[0];
    expect(call?.url).toEqual(new URL(PRESIGNED_URL));
    expect(call?.method).toBe("PUT");
    expect(call?.headers).toEqual({
      "Content-Type": "application/pdf",
      "Content-Length": String(PDF_BYTES.byteLength),
    });
    expect(call?.body).toBe(PDF_BYTES);
    expect(call?.addresses).toEqual([PUBLIC_ADDRESS]);
    expect(call?.timeoutMs).toBe(S3_UPLOAD_TIMEOUT_MS);
    expect(call?.signal).toBeInstanceOf(AbortSignal);
    expect(delivered).toEqual({
      sha256: createHash("sha256").update(PDF_BYTES).digest("hex"),
      sizeBytes: PDF_BYTES.byteLength,
    });
  });

  it("skips the callback allowlist for the presigned URL", async () => {
    const recorder = new RecordingS3Request();
    const { destination } = setup({ request: recorder.request });

    await destination.deliverPdf(
      input({ target: { channel: "s3", value: "https://unlisted-bucket.example.com/put" } }),
    );

    expect(recorder.calls).toHaveLength(1);
  });

  it("pings after the upload", async () => {
    const events: string[] = [];
    const recorder = new RecordingS3Request(async () => {
      events.push("upload");
      return { status: 200 };
    });
    const pingRequest = new RecordingHttpRequest(async () => {
      events.push("ping");
      return { status: 204 };
    });
    const { destination } = setup({ request: recorder.request, pingRequest });

    await destination.deliverPdf(
      input({ target: { channel: "s3", value: PRESIGNED_URL, pingUrl: PING_URL } }),
    );

    expect(events).toEqual(["upload", "ping"]);
    expect(pingRequest.calls[0]?.body).toBe('{"success":true}');
  });

  it("checks a ping URL before uploading", async () => {
    const recorder = new RecordingS3Request();
    const { destination } = setup({ request: recorder.request });

    await expect(
      destination.deliverPdf(
        input({
          target: {
            channel: "s3",
            value: PRESIGNED_URL,
            pingUrl: "https://unlisted.example.com/ping",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(recorder.calls).toHaveLength(0);
  });

  it("logs a failed ping without failing the uploaded PDF", async () => {
    const logger = new CapturingLogger();
    const recorder = new RecordingS3Request();
    const pingRequest = new RecordingHttpRequest(async () => ({ status: 500 }));
    const { destination } = setup({ request: recorder.request, pingRequest, logger });

    await expect(
      destination.deliverPdf(
        input({ target: { channel: "s3", value: PRESIGNED_URL, pingUrl: PING_URL } }),
      ),
    ).resolves.toMatchObject({ sizeBytes: PDF_BYTES.byteLength });
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

  it("maps a non-2xx upload and a transport failure to DELIVERY_FAILED", async () => {
    const statusFailure = setup({
      request: new RecordingS3Request(async () => ({ status: 403 })).request,
    });
    const transportFailure = setup({
      request: new RecordingS3Request(async () => Promise.reject(new Error("network down")))
        .request,
    });

    for (const { destination } of [statusFailure, transportFailure]) {
      await expect(destination.deliverPdf(input())).rejects.toMatchObject({
        name: "DeliveryFailed",
        retryable: true,
      });
    }
  });

  it("requires HTTPS for the presigned URL", async () => {
    const recorder = new RecordingS3Request();
    const { destination } = setup({ request: recorder.request });

    await expect(
      destination.deliverPdf(
        input({
          target: { channel: "s3", value: "http://printer-output.s3.amazonaws.com/upload" },
        }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(recorder.calls).toHaveLength(0);
  });

  it.each([
    "https://169.254.169.254/upload?X-Amz-Signature=abc",
    "https://[fd00:ec2::254]/upload?X-Amz-Signature=abc",
    "https://169.254.10.10/upload?X-Amz-Signature=abc",
  ])("rejects the metadata or link-local literal %s before the PUT", async (value) => {
    const recorder = new RecordingS3Request();
    const { destination } = setup({ request: recorder.request });

    await expect(
      destination.deliverPdf(input({ target: { channel: "s3", value } })),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(recorder.calls).toHaveLength(0);
  });

  it("rejects a hostname that resolves to a metadata address before the PUT", async () => {
    const recorder = new RecordingS3Request();
    const { destination } = setup({
      request: recorder.request,
      resolve: async () => ["169.254.169.254"],
    });

    await expect(
      destination.deliverPdf(
        input({
          target: { channel: "s3", value: "https://s3.example.com/upload?X-Amz-Signature=abc" },
        }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(recorder.calls).toHaveLength(0);
  });

  it("rejects loopback by default and even with the private-endpoint opt-in", async () => {
    for (const allowPrivateEndpoint of [false, true]) {
      const recorder = new RecordingS3Request();
      const { destination } = setup({ request: recorder.request, allowPrivateEndpoint });

      await expect(
        destination.deliverPdf(
          input({ target: { channel: "s3", value: "https://127.0.0.1/upload" } }),
        ),
      ).rejects.toBeInstanceOf(CallbackNotAllowed);
      expect(recorder.calls).toHaveLength(0);
    }
  });

  it.each(["10.0.0.5", "172.16.4.2", "192.168.1.10", "fd12:3456:789a::40", "::ffff:10.0.0.5"])(
    "rejects the private address %s unless the endpoint opt-in allows it",
    async (address) => {
      const rejected = new RecordingS3Request();
      await expect(
        setup({ request: rejected.request, resolve: async () => [address] }).destination.deliverPdf(
          input({ target: { channel: "s3", value: "https://s3.example.com/upload" } }),
        ),
      ).rejects.toBeInstanceOf(CallbackNotAllowed);
      expect(rejected.calls).toHaveLength(0);

      const allowed = new RecordingS3Request();
      await setup({
        request: allowed.request,
        resolve: async () => [address],
        allowPrivateEndpoint: true,
      }).destination.deliverPdf(
        input({ target: { channel: "s3", value: "https://s3.example.com/upload" } }),
      );
      expect(allowed.calls).toHaveLength(1);
    },
  );

  it("still rejects metadata and link-local addresses with the private-endpoint opt-in", async () => {
    for (const address of ["169.254.169.254", "169.254.10.10", "fd00:ec2::254"]) {
      const recorder = new RecordingS3Request();
      await expect(
        setup({
          request: recorder.request,
          resolve: async () => [address],
          allowPrivateEndpoint: true,
        }).destination.deliverPdf(
          input({ target: { channel: "s3", value: "https://s3.example.com/upload" } }),
        ),
      ).rejects.toBeInstanceOf(CallbackNotAllowed);
      expect(recorder.calls).toHaveLength(0);
    }
  });

  it("maps a malformed URL to the terminal CALLBACK_NOT_ALLOWED error", async () => {
    const recorder = new RecordingS3Request();
    const { destination } = setup({ request: recorder.request });

    await expect(
      destination.deliverPdf(input({ target: { channel: "s3", value: "not a url" } })),
    ).rejects.toMatchObject({
      name: "CallbackNotAllowed",
      code: "CALLBACK_NOT_ALLOWED",
      retryable: false,
    });
    expect(recorder.calls).toHaveLength(0);
  });

  it("rejects a non-s3 channel", async () => {
    const recorder = new RecordingS3Request();
    const { destination } = setup({ request: recorder.request });

    await expect(
      destination.deliverPdf(
        input({ target: { channel: "sqs", value: "arn:aws:sqs:eu-central-1:123456789012:q" } }),
      ),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
    expect(recorder.calls).toHaveLength(0);
  });
});

describe("pinned S3 PUT transport", () => {
  it("connects to the validated address and forwards the PDF body", async () => {
    const received: { host?: string; body: Uint8Array }[] = [];
    const server = createServer((request: IncomingMessage, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ host: request.headers.host, body: new Uint8Array(Buffer.concat(chunks)) });
        response.writeHead(200);
        response.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await pinnedHttpRequest({
        url: new URL(`http://s3.example.com:${String(port)}/upload`),
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(PDF_BYTES.byteLength),
        },
        body: PDF_BYTES,
        addresses: ["127.0.0.1"],
        timeoutMs: 2_000,
      });

      expect(result.status).toBe(200);
      expect(received).toHaveLength(1);
      expect(received[0]?.host).toBe(`s3.example.com:${String(port)}`);
      expect(received[0]?.body).toEqual(PDF_BYTES);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
