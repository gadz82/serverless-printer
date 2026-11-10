import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";

import { CallbackNotAllowed, DeliveryFailed } from "@printer/domain";
import type { DeliverPdfInput, DeliveredPdf, PdfDestination } from "@printer/domain";

import {
  blockedAddressReason,
  parseIpAddress,
  type ParsedIpAddress,
} from "../security/ip-address.js";
import type { CallbackPing } from "./callback-ping.js";
import { isSuccessStatus, pinnedHttpRequest, type PinnedHttpRequest } from "./http-request.js";

export type S3DnsResolver = (hostname: string) => Promise<readonly string[]>;

export const S3_UPLOAD_TIMEOUT_MS = 30_000;

const dnsResolver: S3DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export type S3PdfDestinationOptions = {
  readonly pings: CallbackPing;
  /** Transport seam; production uses the shared pinned HTTP transport. */
  readonly request?: PinnedHttpRequest;
  /** Test seam; production resolves through the process DNS configuration. */
  readonly resolve?: S3DnsResolver;
  /** Explicit opt-in for private VPC S3 endpoints; default false. */
  readonly allowPrivateEndpoint?: boolean;
};

/**
 * Uploads the rendered PDF to the caller's presigned PUT URL.
 *
 * The presigned URL is intentionally not subject to the callback allowlist:
 * it is caller-owned, short-lived and only accepts a PUT. HTTPS, DNS pinning
 * and an SSRF address check still apply. Loopback, metadata and link-local
 * addresses are always rejected; private VPC endpoints need an explicit opt-in.
 */
export class S3PdfDestination implements PdfDestination {
  private readonly pings: CallbackPing;
  private readonly request: PinnedHttpRequest;
  private readonly resolve: S3DnsResolver;
  private readonly allowPrivateEndpoint: boolean;

  constructor(options: S3PdfDestinationOptions) {
    this.pings = options.pings;
    this.request = options.request ?? pinnedHttpRequest;
    this.resolve = options.resolve ?? dnsResolver;
    this.allowPrivateEndpoint = options.allowPrivateEndpoint ?? false;
  }

  async deliverPdf(input: DeliverPdfInput): Promise<DeliveredPdf> {
    if (input.target.channel !== "s3") {
      throw new CallbackNotAllowed(`unsupported callback channel: ${input.target.channel}`);
    }

    const url = parsePresignedUrl(input.target.value);
    const addresses = await this.assertSafeDestination(url);
    const ping = await this.pings.prepare(input.target.pingUrl);

    let response;
    try {
      response = await this.request({
        url,
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(input.pdfBytes.byteLength),
        },
        body: input.pdfBytes,
        addresses,
        timeoutMs: S3_UPLOAD_TIMEOUT_MS,
        signal: AbortSignal.timeout(S3_UPLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DeliveryFailed("failed to upload PDF to S3", { cause: error });
    }

    if (!isSuccessStatus(response.status)) {
      throw new DeliveryFailed(`S3 upload returned status ${String(response.status)}`);
    }

    if (ping !== null) {
      await this.pings.send(ping, true, {
        messageId: input.messageId,
        printId: input.printId,
      });
    }

    return {
      sha256: createHash("sha256").update(input.pdfBytes).digest("hex"),
      sizeBytes: input.pdfBytes.byteLength,
    };
  }

  private async assertSafeDestination(url: URL): Promise<readonly string[]> {
    const host = normalizeHostname(url.hostname);
    const literal = parseIpAddress(host);
    let addresses: readonly string[];

    if (literal !== null) {
      addresses = [host];
    } else {
      try {
        addresses = await this.resolve(host);
      } catch (error) {
        throw new DeliveryFailed("failed to resolve the presigned S3 host", { cause: error });
      }
    }

    if (addresses.length === 0) {
      throw new DeliveryFailed("the presigned S3 host did not resolve");
    }

    for (const address of addresses) {
      const parsed = parseIpAddress(address);
      if (parsed === null) {
        throw new DeliveryFailed("the presigned S3 host resolved to an invalid address");
      }
      // Loopback, metadata, link-local and non-routable destinations stay
      // blocked even when a private VPC endpoint was explicitly allowed.
      if (blockedAddressReason(parsed, false) !== null) {
        throw new CallbackNotAllowed("presigned S3 URL resolves to a blocked address");
      }
      if (!this.allowPrivateEndpoint && isPrivateAddress(parsed)) {
        throw new CallbackNotAllowed("presigned S3 URL resolves to a private address");
      }
    }

    return addresses;
  }
}

function parsePresignedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new CallbackNotAllowed("callback target is not a valid presigned S3 URL", {
      cause: error,
    });
  }

  if (url.protocol !== "https:") {
    throw new CallbackNotAllowed("presigned S3 URL must use HTTPS");
  }

  return url;
}

function normalizeHostname(raw: string): string {
  let host = raw.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  return host;
}

function isPrivateAddress(address: ParsedIpAddress): boolean {
  if (address.family === 4) {
    return isPrivateIpv4(address.value);
  }

  const mappedIpv4 = extractMappedIpv4(address.groups);
  if (mappedIpv4 !== null) {
    return isPrivateIpv4(mappedIpv4);
  }

  // fc00::/7 is the IPv6 unique-local range.
  return ((address.groups[0] ?? 0) & 0xfe00) === 0xfc00;
}

function isPrivateIpv4(value: number): boolean {
  return (
    isIpv4InRange(value, [10, 0, 0, 0], 8) ||
    isIpv4InRange(value, [172, 16, 0, 0], 12) ||
    isIpv4InRange(value, [192, 168, 0, 0], 16)
  );
}

function extractMappedIpv4(groups: readonly number[]): number | null {
  if (groups.length !== 8 || groups.slice(0, 5).some((group) => group !== 0)) {
    return null;
  }

  const high = groups[5] ?? 0;
  const low = (((groups[6] ?? 0) << 16) | (groups[7] ?? 0)) >>> 0;

  if (high === 0xffff) {
    return low;
  }
  if (high === 0 && low !== 0 && low !== 1) {
    return low;
  }
  return null;
}

function isIpv4InRange(
  value: number,
  network: readonly [number, number, number, number],
  prefixLength: number,
): boolean {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (ipv4ToNumber(network) & mask);
}

function ipv4ToNumber(octets: readonly [number, number, number, number]): number {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}
