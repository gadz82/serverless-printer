import { lookup } from "node:dns/promises";
import { CallbackNotAllowed, type CallbackTarget } from "@printer/domain";
import { blockedAddressReason, parseIpAddress } from "./ip-address.js";

export type DnsResolver = (hostname: string) => Promise<readonly string[]>;

export type CallbackPolicyOptions = {
  readonly allowlist: readonly string[];
  /** Test seam; the default resolver uses the process DNS configuration. */
  readonly resolver?: DnsResolver;
  /**
   * Local/test escape hatch. Loopback is refused otherwise, even when the
   * allowlist names the host.
   */
  readonly allowLoopback?: boolean;
};

export type CallbackDenyReason =
  | "malformed_url"
  | "unsupported_scheme"
  | "credentials_not_allowed"
  | "metadata_host"
  | "host_not_allowlisted"
  | "scheme_not_allowlisted"
  | "port_not_allowlisted"
  | "dns_failure"
  | "metadata_address"
  | "link_local_address"
  | "loopback_address"
  | "non_routable_address";

export type CallbackDecision =
  | {
      readonly allowed: true;
      readonly url: URL;
      readonly addresses: readonly string[];
    }
  | {
      readonly allowed: false;
      readonly reason: CallbackDenyReason;
      readonly message: string;
    };

// ORCHID-MEM: 01a1c6e2-73d3-750f-a5bd-47127cb77c34 — Enforces the callback allowlist plus DNS, loopback and metadata SSRF policy.
export class CallbackPolicyConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CallbackPolicyConfigurationError";
  }
}

type CallbackScheme = "http" | "https";

type AllowlistRule = {
  readonly scheme: CallbackScheme;
  readonly wildcard: boolean;
  readonly host: string;
  readonly port: number;
};

const DEFAULT_PORTS: Readonly<Record<CallbackScheme, number>> = {
  http: 80,
  https: 443,
};

const METADATA_HOSTS = new Set([
  "instance-data",
  "instance-data.ec2.internal",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
]);

const DENY_MESSAGES: Readonly<Record<CallbackDenyReason, string>> = {
  malformed_url: "callback URL is malformed",
  unsupported_scheme: "callback URL must use http or https",
  credentials_not_allowed: "callback URL must not contain credentials",
  metadata_host: "callback host is a metadata endpoint",
  host_not_allowlisted: "callback host is not allowlisted",
  scheme_not_allowlisted: "callback scheme is not allowlisted for this host",
  port_not_allowlisted: "callback port is not allowlisted for this host",
  dns_failure: "callback host could not be resolved",
  metadata_address: "callback host resolves to a metadata address",
  link_local_address: "callback host resolves to a link-local address",
  loopback_address: "callback host resolves to a loopback address",
  non_routable_address: "callback host resolves to a non-routable address",
};

const dnsLookupResolver: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Pure async allowlist and SSRF gate for HTTP callbacks and ping URLs.
 *
 * It parses entries once, matches scheme, host and port, then resolves the host
 * and classifies every returned address. It never performs a request and never
 * includes the full URL in a denial, so callers can log the reason safely.
 */
export class CallbackPolicy {
  private readonly allowlist: readonly AllowlistRule[];
  private readonly resolver: DnsResolver;
  private readonly allowLoopback: boolean;

  constructor(options: CallbackPolicyOptions) {
    this.allowlist = options.allowlist.map((entry, index) => parseAllowlistEntry(entry, index));
    this.resolver = options.resolver ?? dnsLookupResolver;
    this.allowLoopback = options.allowLoopback ?? false;
  }

  async evaluate(rawUrl: string | URL): Promise<CallbackDecision> {
    const url = typeof rawUrl === "string" ? parseUrl(rawUrl) : rawUrl;
    if (url === null) {
      return deny("malformed_url");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return deny("unsupported_scheme");
    }
    if (url.username !== "" || url.password !== "") {
      return deny("credentials_not_allowed");
    }

    const host = normalizeHostname(url.hostname);
    if (host.length === 0 || host.includes("*")) {
      return deny("malformed_url");
    }
    if (METADATA_HOSTS.has(host)) {
      return deny("metadata_host");
    }

    const scheme: CallbackScheme = url.protocol === "https:" ? "https" : "http";
    const port = url.port === "" ? DEFAULT_PORTS[scheme] : Number(url.port);
    const literal = parseIpAddress(host);

    // A literal is checked before the allowlist so a metadata or link-local
    // address cannot hide behind an allowlisted IP entry.
    if (literal !== null) {
      const blocked = blockedAddressReason(literal, this.allowLoopback);
      if (blocked !== null) {
        return deny(blocked);
      }
    }

    const hostRules = this.allowlist.filter((rule) => matchesHost(rule, host));
    if (hostRules.length === 0) {
      return deny("host_not_allowlisted");
    }

    const schemeRules = hostRules.filter((rule) => rule.scheme === scheme);
    if (schemeRules.length === 0) {
      return deny("scheme_not_allowlisted");
    }
    if (!schemeRules.some((rule) => rule.port === port)) {
      return deny("port_not_allowlisted");
    }

    let addresses: readonly string[];
    if (literal !== null) {
      addresses = [host];
    } else {
      try {
        addresses = [...(await this.resolver(host))];
      } catch {
        return deny("dns_failure");
      }
    }

    if (addresses.length === 0) {
      return deny("dns_failure");
    }

    for (const address of addresses) {
      const parsedAddress = parseIpAddress(address);
      if (parsedAddress === null) {
        return deny("dns_failure");
      }
      const blocked = blockedAddressReason(parsedAddress, this.allowLoopback);
      if (blocked !== null) {
        return deny(blocked);
      }
    }

    return { allowed: true, url, addresses: Object.freeze(addresses) };
  }

  /**
   * Throws the domain's CALLBACK_NOT_ALLOWED error at the job boundary. The
   * message names the policy reason, never the URL or its path.
   */
  async assertAllowed(rawUrl: string | URL): Promise<URL> {
    const decision = await this.evaluate(rawUrl);
    if (!decision.allowed) {
      throw new CallbackNotAllowed(decision.message);
    }
    return decision.url;
  }

  /**
   * Applies §4.6 to one target: HTTP channel values and every ping URL are
   * checked; other channel values are AWS identifiers and are not URLs here.
   */
  async assertTargetAllowed(target: CallbackTarget): Promise<void> {
    if (target.channel === "http") {
      await this.assertAllowed(target.value);
    }
    if (target.pingUrl !== undefined && target.pingUrl !== null) {
      await this.assertAllowed(target.pingUrl);
    }
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function parseAllowlistEntry(entry: string, index: number): AllowlistRule {
  const invalid = (cause?: unknown): CallbackPolicyConfigurationError =>
    new CallbackPolicyConfigurationError(
      `CALLBACK_ALLOWLIST entry ${index} is not a valid scheme://host[:port] pattern`,
      cause === undefined ? undefined : { cause },
    );

  let url: URL;
  try {
    url = new URL(entry.trim());
  } catch (error) {
    throw invalid(error);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalid();
  }
  if (url.username !== "" || url.password !== "") {
    throw invalid();
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw invalid();
  }

  const scheme: CallbackScheme = url.protocol === "https:" ? "https" : "http";
  const hostname = normalizeHostname(url.hostname);
  if (hostname.length === 0) {
    throw invalid();
  }

  const wildcard = hostname.startsWith("*.");
  let host = hostname;
  if (hostname.includes("*")) {
    if (!wildcard) {
      throw invalid();
    }
    host = hostname.slice(2);
    if (host.length === 0 || host.includes("*")) {
      throw invalid();
    }
  }

  const port = url.port === "" ? DEFAULT_PORTS[scheme] : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw invalid();
  }

  return { scheme, wildcard, host, port };
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

function matchesHost(rule: AllowlistRule, host: string): boolean {
  if (!rule.wildcard) {
    return host === rule.host;
  }
  return host !== rule.host && host.endsWith(`.${rule.host}`);
}

function deny(reason: CallbackDenyReason): CallbackDecision {
  return { allowed: false, reason, message: DENY_MESSAGES[reason] };
}
