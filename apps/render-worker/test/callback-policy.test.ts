import { describe, expect, it } from "vitest";
import { CallbackNotAllowed } from "@printer/domain";
import {
  CallbackPolicy,
  CallbackPolicyConfigurationError,
  type CallbackDecision,
  type CallbackDenyReason,
} from "../src/security/index.js";

const PUBLIC_ADDRESS = "203.0.113.10";

type PolicyOptions = {
  readonly addresses?: readonly string[];
  readonly allowLoopback?: boolean;
};

function policyFor(allowlist: readonly string[], options: PolicyOptions = {}): CallbackPolicy {
  return new CallbackPolicy({
    allowlist,
    resolver: async () => options.addresses ?? [PUBLIC_ADDRESS],
    ...(options.allowLoopback === undefined ? {} : { allowLoopback: options.allowLoopback }),
  });
}

function expectDenied(decision: CallbackDecision, reason: CallbackDenyReason): void {
  if (decision.allowed) {
    throw new Error(`expected denial ${reason}, but the URL was allowed`);
  }
  expect(decision.reason).toBe(reason);
  expect(decision.message.length).toBeGreaterThan(0);
}

describe("CallbackPolicy allowlist matching", () => {
  it("allows an exact host and preserves the request URL", async () => {
    const decision = await policyFor(["https://callbacks.example.com"]).evaluate(
      "https://callbacks.example.com/hook?job=42",
    );

    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.url.href).toBe("https://callbacks.example.com/hook?job=42");
      expect(decision.addresses).toEqual([PUBLIC_ADDRESS]);
    }
  });

  it("does not allow a subdomain of an exact host", async () => {
    const decision = await policyFor(["https://callbacks.example.com"]).evaluate(
      "https://api.callbacks.example.com/hook",
    );

    expectDenied(decision, "host_not_allowlisted");
  });

  it("allows wildcard subdomains at any depth but not the apex", async () => {
    const policy = policyFor(["https://*.example.net"]);

    expect((await policy.evaluate("https://api.example.net/hook")).allowed).toBe(true);
    expect((await policy.evaluate("https://one.two.example.net/hook")).allowed).toBe(true);
    expectDenied(await policy.evaluate("https://example.net/hook"), "host_not_allowlisted");
  });

  it("matches an explicit port and rejects every other port", async () => {
    const policy = policyFor(["https://callbacks.example.com:8443"]);

    expect((await policy.evaluate("https://callbacks.example.com:8443/hook")).allowed).toBe(true);
    expectDenied(
      await policy.evaluate("https://callbacks.example.com/hook"),
      "port_not_allowlisted",
    );
    expectDenied(
      await policy.evaluate("https://callbacks.example.com:9443/hook"),
      "port_not_allowlisted",
    );
  });

  it("only matches the default port when the entry has no port", async () => {
    const policy = policyFor(["https://callbacks.example.com"]);

    expect((await policy.evaluate("https://callbacks.example.com:443/hook")).allowed).toBe(true);
    expectDenied(
      await policy.evaluate("https://callbacks.example.com:8443/hook"),
      "port_not_allowlisted",
    );
  });

  it("normalizes case, a trailing dot and the resolver hostname", async () => {
    const calls: string[] = [];
    const policy = new CallbackPolicy({
      allowlist: ["HTTPS://Callbacks.Example.COM."],
      resolver: async (hostname) => {
        calls.push(hostname);
        return [PUBLIC_ADDRESS];
      },
    });

    const decision = await policy.evaluate("https://CALLBACKS.Example.COM./hook");

    expect(decision.allowed).toBe(true);
    expect(calls).toEqual(["callbacks.example.com"]);
  });

  it("does not resolve a host that is not allowlisted", async () => {
    const calls: string[] = [];
    const policy = new CallbackPolicy({
      allowlist: ["https://callbacks.example.com"],
      resolver: async (hostname) => {
        calls.push(hostname);
        return [PUBLIC_ADDRESS];
      },
    });

    expectDenied(
      await policy.evaluate("https://unlisted.example.com/hook"),
      "host_not_allowlisted",
    );
    expect(calls).toEqual([]);
  });
});

describe("CallbackPolicy scheme handling", () => {
  it("requires https when only an https entry exists", async () => {
    const policy = policyFor(["https://callbacks.example.com"]);

    expectDenied(
      await policy.evaluate("http://callbacks.example.com/hook"),
      "scheme_not_allowlisted",
    );
    expect((await policy.evaluate("https://callbacks.example.com/hook")).allowed).toBe(true);
  });

  it("allows http only when the entry explicitly uses http", async () => {
    const policy = policyFor(["http://callbacks.example.com"]);

    expect((await policy.evaluate("http://callbacks.example.com/hook")).allowed).toBe(true);
    expectDenied(
      await policy.evaluate("https://callbacks.example.com/hook"),
      "scheme_not_allowlisted",
    );
  });

  it("matches the scheme for wildcard entries as well", async () => {
    const policy = policyFor(["http://*.example.net"]);

    expect((await policy.evaluate("http://api.example.net/hook")).allowed).toBe(true);
    expectDenied(await policy.evaluate("https://api.example.net/hook"), "scheme_not_allowlisted");
  });
});

describe("CallbackPolicy SSRF checks", () => {
  it("allows a named private VPC host", async () => {
    const decision = await policyFor(["https://internal.example.com"], {
      addresses: ["10.20.30.40"],
    }).evaluate("https://internal.example.com/hook");

    expect(decision.allowed).toBe(true);
  });

  it("allows a named IPv6 unique-local host", async () => {
    const decision = await policyFor(["https://internal.example.com"], {
      addresses: ["fd12:3456:789a::40"],
    }).evaluate("https://internal.example.com/hook");

    expect(decision.allowed).toBe(true);
  });

  it("allows an allowlisted private IP literal", async () => {
    const decision = await policyFor(["https://10.20.30.40:8443"]).evaluate(
      "https://10.20.30.40:8443/hook",
    );

    expect(decision.allowed).toBe(true);
  });

  it.each([
    ["169.254.10.10", "link_local_address"],
    ["169.254.169.254", "metadata_address"],
    ["100.100.100.200", "metadata_address"],
    ["fd00:ec2::254", "metadata_address"],
    ["fd20:ce::254", "metadata_address"],
    ["fe80::1", "link_local_address"],
    ["127.0.0.1", "loopback_address"],
    ["::1", "loopback_address"],
    ["::ffff:169.254.10.10", "link_local_address"],
    ["::ffff:127.0.0.1", "loopback_address"],
    ["0.0.0.0", "non_routable_address"],
    ["224.0.0.1", "non_routable_address"],
  ] as const)("rejects %s returned by DNS", async (address, reason) => {
    const decision = await policyFor(["https://internal.example.com"], {
      addresses: [address],
    }).evaluate("https://internal.example.com/hook");

    expectDenied(decision, reason);
  });

  it("rejects a host when any resolved address is unsafe", async () => {
    const decision = await policyFor(["https://internal.example.com"], {
      addresses: [PUBLIC_ADDRESS, "169.254.169.254"],
    }).evaluate("https://internal.example.com/hook");

    expectDenied(decision, "metadata_address");
  });

  it.each([
    ["https://[::ffff:169.254.169.254]", "metadata_address"],
    ["https://[::169.254.169.254]", "metadata_address"],
    ["https://[fd00:ec2::254]", "metadata_address"],
    ["https://[fe80::1]", "link_local_address"],
  ] as const)("rejects the IPv6 literal %s before any request", async (url, reason) => {
    const decision = await policyFor([url]).evaluate(url);

    expectDenied(decision, reason);
  });

  it("rejects metadata hostnames even when the allowlist matches", async () => {
    const calls: string[] = [];
    const policy = new CallbackPolicy({
      allowlist: ["https://*.google.internal"],
      resolver: async (hostname) => {
        calls.push(hostname);
        return [PUBLIC_ADDRESS];
      },
    });

    expectDenied(
      await policy.evaluate("https://metadata.google.internal/computeMetadata/v1"),
      "metadata_host",
    );
    expect(calls).toEqual([]);
  });

  it("refuses loopback by default even when it is allowlisted", async () => {
    const policy = policyFor(["https://localhost", "https://[::1]"], {
      addresses: ["127.0.0.1"],
    });

    expectDenied(await policy.evaluate("https://localhost/hook"), "loopback_address");
    expectDenied(await policy.evaluate("https://[::1]/hook"), "loopback_address");
  });

  it("allows loopback only when explicitly enabled and allowlisted", async () => {
    const policy = policyFor(["https://localhost", "https://[::1]"], {
      addresses: ["127.0.0.1"],
      allowLoopback: true,
    });

    expect((await policy.evaluate("https://localhost/hook")).allowed).toBe(true);
    expect((await policy.evaluate("https://[::1]/hook")).allowed).toBe(true);
    expectDenied(await policy.evaluate("https://127.0.0.1/hook"), "host_not_allowlisted");
  });
});

describe("CallbackPolicy malformed input and failures", () => {
  it.each([
    "callbacks.example.com",
    "ftp://callbacks.example.com",
    "https://callbacks.example.com/path",
    "https://callbacks.example.com?x=1",
    "https://callbacks.example.com#fragment",
    "https://user:pass@callbacks.example.com",
    "https://*",
    "https://foo.*.example.com",
    "https://*.example.com:not-a-port",
    "https://",
  ])("rejects the malformed allowlist entry %s", (entry) => {
    expect(
      () =>
        new CallbackPolicy({
          allowlist: [entry],
          resolver: async () => [PUBLIC_ADDRESS],
        }),
    ).toThrow(CallbackPolicyConfigurationError);
  });

  it("names the offending allowlist index without echoing the entry", () => {
    expect(
      () =>
        new CallbackPolicy({
          allowlist: ["https://valid.example.com", "not-a-pattern"],
          resolver: async () => [PUBLIC_ADDRESS],
        }),
    ).toThrow(/CALLBACK_ALLOWLIST entry 1/);
  });

  it.each([
    ["not a url", "malformed_url"],
    ["ftp://callbacks.example.com/hook", "unsupported_scheme"],
    ["https://user:pass@callbacks.example.com/hook", "credentials_not_allowed"],
  ] as const)("rejects the malformed callback URL %s", async (url, reason) => {
    const decision = await policyFor(["https://callbacks.example.com"]).evaluate(url);

    expectDenied(decision, reason);
  });

  it("rejects a literal wildcard in the callback host", async () => {
    const decision = await policyFor(["https://*.example.com"]).evaluate(
      "https://evil*.example.com/hook",
    );

    expectDenied(decision, "malformed_url");
  });

  it("rejects a DNS resolution failure", async () => {
    const policy = new CallbackPolicy({
      allowlist: ["https://internal.example.com"],
      resolver: async () => {
        throw new Error("ENOTFOUND");
      },
    });

    expectDenied(await policy.evaluate("https://internal.example.com/hook"), "dns_failure");
  });

  it("rejects an empty DNS answer", async () => {
    const decision = await policyFor(["https://internal.example.com"], {
      addresses: [],
    }).evaluate("https://internal.example.com/hook");

    expectDenied(decision, "dns_failure");
  });

  it("rejects a DNS answer that is not an IP address", async () => {
    const decision = await policyFor(["https://internal.example.com"], {
      addresses: ["not-an-ip"],
    }).evaluate("https://internal.example.com/hook");

    expectDenied(decision, "dns_failure");
  });

  it("maps a denial to CALLBACK_NOT_ALLOWED without exposing the URL", async () => {
    const policy = policyFor(["https://callbacks.example.com"]);
    const url = "https://unlisted.example.com/secret-token?token=abc";

    await expect(policy.assertAllowed(url)).rejects.toBeInstanceOf(CallbackNotAllowed);

    try {
      await policy.assertAllowed(url);
      throw new Error("expected assertAllowed to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CallbackNotAllowed);
      const denial = error as CallbackNotAllowed;
      expect(denial.code).toBe("CALLBACK_NOT_ALLOWED");
      expect(denial.retryable).toBe(false);
      expect(denial.message).not.toContain("unlisted.example.com");
      expect(denial.message).not.toContain("secret-token");
      expect(denial.message).not.toContain("token=abc");
    }
  });
});

describe("CallbackPolicy target handling", () => {
  it("checks http values and every ping URL", async () => {
    const policy = policyFor(["https://callbacks.example.com"]);

    await expect(
      policy.assertTargetAllowed({
        channel: "http",
        value: "https://callbacks.example.com/result",
        pingUrl: "https://callbacks.example.com/ping",
      }),
    ).resolves.toBeUndefined();

    await expect(
      policy.assertTargetAllowed({
        channel: "sqs",
        value: "arn:aws:sqs:eu-central-1:123456789012:printer-callbacks",
        pingUrl: "https://callbacks.example.com/ping",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an http value or a ping URL outside the policy", async () => {
    const policy = policyFor(["https://callbacks.example.com"]);

    await expect(
      policy.assertTargetAllowed({
        channel: "http",
        value: "http://callbacks.example.com/result",
      }),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);

    await expect(
      policy.assertTargetAllowed({
        channel: "lambda",
        value: "arn:aws:lambda:eu-central-1:123456789012:function:printer-results",
        pingUrl: "http://callbacks.example.com/ping",
      }),
    ).rejects.toBeInstanceOf(CallbackNotAllowed);
  });

  it("does not apply the URL policy to non-http channel values", async () => {
    const policy = policyFor([]);

    await expect(
      policy.assertTargetAllowed({
        channel: "s3",
        value: "https://unlisted-bucket.s3.amazonaws.com/put",
      }),
    ).resolves.toBeUndefined();
  });
});
