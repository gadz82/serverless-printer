import { createHash } from "node:crypto";
import type { PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  PrintStorageError,
  S3PrintRepository,
  printObjectKey,
  sha256Hex,
  type PresignPrintGet,
  type PrintObjectClient,
} from "../src/adapters/s3-print-repository.js";

const PRINT_ID = "3f0c8b7a-1d2e-4f3a-8b6c-9d0e1f2a3b4c";
const BUCKET = "printer-prints";

class RecordingS3Client implements PrintObjectClient {
  readonly commands: PutObjectCommand[] = [];

  constructor(private readonly failure?: Error) {}

  async send(command: PutObjectCommand): Promise<unknown> {
    this.commands.push(command);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return {};
  }
}

type PresignCall = {
  readonly bucket: string;
  readonly key: string;
  readonly expiresIn: number;
};

function recordingPresign(
  result = "https://prints.example.com/prints/print.pdf?X-Amz-Signature=abc",
): { calls: PresignCall[]; presign: PresignPrintGet } {
  const calls: PresignCall[] = [];
  return {
    calls,
    presign: async (input) => {
      calls.push(input);
      return result;
    },
  };
}

const now = (): Date => new Date("2026-11-09T10:00:00.000Z");

describe("S3PrintRepository", () => {
  it("stores the PDF, hashes the bytes and presigns a GET with the configured TTL", async () => {
    const client = new RecordingS3Client();
    const { calls, presign } = recordingPresign();
    const bytes = new TextEncoder().encode("hello");
    let nowCalls = 0;
    const advancingNow = (): Date =>
      new Date(nowCalls++ === 0 ? "2026-11-09T10:00:00.000Z" : "2026-11-09T10:10:00.000Z");
    const repository = new S3PrintRepository({
      client,
      bucket: BUCKET,
      presignTtlSeconds: 900,
      presign,
      now: advancingNow,
    });

    const stored = await repository.store({ printId: PRINT_ID, templateBytes: bytes });

    const command = client.commands[0];
    expect(command).toBeDefined();
    expect(command?.input).toEqual({
      Bucket: BUCKET,
      Key: `prints/${PRINT_ID}.pdf`,
      Body: bytes,
      ContentType: "application/pdf",
      ContentLength: 5,
    });
    expect(stored).toEqual({
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      sizeBytes: 5,
      printing: "https://prints.example.com/prints/print.pdf?X-Amz-Signature=abc",
      printingExpiresAt: "2026-11-09T10:15:00.000Z",
    });
    expect(calls).toEqual([{ bucket: BUCKET, key: `prints/${PRINT_ID}.pdf`, expiresIn: 900 }]);
  });

  it("uses the print id in the object key", () => {
    expect(printObjectKey(PRINT_ID)).toBe(`prints/${PRINT_ID}.pdf`);
  });

  it("hashes bytes with SHA-256", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("wraps storage and presign failures with their cause", async () => {
    const cause = new Error("s3 unavailable");
    const repository = new S3PrintRepository({
      client: new RecordingS3Client(cause),
      bucket: BUCKET,
      presignTtlSeconds: 900,
      presign: async () => "https://example.com",
      now,
    });

    await expect(
      repository.store({ printId: PRINT_ID, templateBytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ name: "PrintStorageError", cause });

    const presignRepository = new S3PrintRepository({
      client: new RecordingS3Client(),
      bucket: BUCKET,
      presignTtlSeconds: 900,
      presign: async () => {
        throw cause;
      },
      now,
    });
    await expect(
      presignRepository.store({ printId: PRINT_ID, templateBytes: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(PrintStorageError);
  });
});
