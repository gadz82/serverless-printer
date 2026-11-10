import { isIP } from "node:net";

export type ParsedIpAddress =
  | { readonly family: 4; readonly value: number }
  | { readonly family: 6; readonly groups: readonly number[] };

export type AddressBlockReason =
  "metadata_address" | "link_local_address" | "loopback_address" | "non_routable_address";

const IPV4_METADATA_ADDRESSES = new Set([
  0xa9fea9fe, // 169.254.169.254, used by AWS, Azure, GCP, OpenStack and others.
  0x646464c8, // 100.100.100.200, the Alibaba Cloud metadata endpoint.
]);

const IPV6_METADATA_GROUPS = [
  [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254], // AWS fd00:ec2::254.
  [0xfd20, 0x00ce, 0, 0, 0, 0, 0, 0x0254], // Google Cloud fd20:ce::254.
] as const;

/**
 * Classifies an address before a callback request. Private VPC ranges are not
 * blocked: callers may allowlist named internal hosts. Metadata, link-local,
 * loopback and non-routable destinations are always refused unless loopback is
 * explicitly enabled for a local/test setup.
 */
export function blockedAddressReason(
  address: ParsedIpAddress,
  allowLoopback: boolean,
): AddressBlockReason | null {
  if (address.family === 4) {
    return blockedIpv4Reason(address.value, allowLoopback);
  }

  // DNS answers and URL literals can spell an IPv4 destination as a mapped or
  // compatible IPv6 address; classify the embedded address, not the wrapper.
  const mappedIpv4 = extractMappedIpv4(address.groups);
  if (mappedIpv4 !== null) {
    return blockedIpv4Reason(mappedIpv4, allowLoopback);
  }

  return blockedIpv6Reason(address.groups, allowLoopback);
}

export function parseIpAddress(rawAddress: string): ParsedIpAddress | null {
  const address = stripZone(rawAddress.trim());
  const family = isIP(address);

  if (family === 4) {
    const value = parseIpv4(address);
    return value === null ? null : { family: 4, value };
  }

  if (family === 6) {
    const groups = parseIpv6(address);
    return groups === null ? null : { family: 6, groups };
  }

  return null;
}

function blockedIpv4Reason(value: number, allowLoopback: boolean): AddressBlockReason | null {
  if (IPV4_METADATA_ADDRESSES.has(value)) {
    return "metadata_address";
  }
  if (isIpv4InRange(value, [169, 254, 0, 0], 16)) {
    return "link_local_address";
  }
  if (isIpv4InRange(value, [127, 0, 0, 0], 8)) {
    return allowLoopback ? null : "loopback_address";
  }
  if (isIpv4InRange(value, [0, 0, 0, 0], 8)) {
    return "non_routable_address";
  }
  if (isIpv4InRange(value, [224, 0, 0, 0], 4) || isIpv4InRange(value, [240, 0, 0, 0], 4)) {
    return "non_routable_address";
  }

  return null;
}

function blockedIpv6Reason(
  groups: readonly number[],
  allowLoopback: boolean,
): AddressBlockReason | null {
  if (IPV6_METADATA_GROUPS.some((metadata) => sameGroups(groups, metadata))) {
    return "metadata_address";
  }
  if (((groups[0] ?? 0) & 0xffc0) === 0xfe80) {
    return "link_local_address";
  }
  if (groups.every((group) => group === 0)) {
    return "non_routable_address";
  }
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return allowLoopback ? null : "loopback_address";
  }
  if (((groups[0] ?? 0) & 0xff00) === 0xff00) {
    return "non_routable_address";
  }

  return null;
}

function extractMappedIpv4(groups: readonly number[]): number | null {
  if (groups.length !== 8) {
    return null;
  }
  for (const group of groups.slice(0, 5)) {
    if (group !== 0) {
      return null;
    }
  }

  const high = groups[5] ?? 0;
  const low = (((groups[6] ?? 0) << 16) | (groups[7] ?? 0)) >>> 0;

  if (high === 0xffff) {
    return low;
  }

  // IPv4-compatible ::a.b.c.d is deprecated but still parsed by runtimes. Keep
  // :: and ::1 as IPv6 so their own loopback/unspecified handling applies.
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

function parseIpv4(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let value = 0;
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }

  return value >>> 0;
}

function parseIpv6(address: string): readonly number[] | null {
  const sections = address.split("::");
  if (sections.length > 2) {
    return null;
  }

  const head = parseIpv6Section(sections[0] ?? "");
  if (head === null) {
    return null;
  }

  if (sections.length === 1) {
    return head.length === 8 ? head : null;
  }

  const tail = parseIpv6Section(sections[1] ?? "");
  if (tail === null) {
    return null;
  }

  const missing = 8 - head.length - tail.length;
  if (missing < 1) {
    return null;
  }

  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function parseIpv6Section(section: string): readonly number[] | null {
  if (section === "") {
    return [];
  }

  const parts = section.split(":");
  const groups: number[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";

    if (part.includes(".")) {
      if (index !== parts.length - 1) {
        return null;
      }
      const embedded = parseIpv4(part);
      if (embedded === null) {
        return null;
      }
      groups.push((embedded >>> 16) & 0xffff, embedded & 0xffff);
      continue;
    }

    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
      return null;
    }
    groups.push(Number.parseInt(part, 16));
  }

  return groups;
}

function sameGroups(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((group, index) => group === right[index]);
}

function stripZone(address: string): string {
  const zoneIndex = address.indexOf("%");
  return zoneIndex === -1 ? address : address.slice(0, zoneIndex);
}
