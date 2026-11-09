import { createHash } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { PrintRepository, StoredPrint, StorePrintInput } from "@printer/domain";

export type PrintObjectClient = {
  send(command: PutObjectCommand): Promise<unknown>;
};

export type PresignPrintGet = (input: {
  readonly bucket: string;
  readonly key: string;
  readonly expiresIn: number;
}) => Promise<string>;

export type S3PrintRepositoryOptions = {
  readonly client: PrintObjectClient;
  readonly bucket: string;
  readonly presignTtlSeconds: number;
  readonly presign: PresignPrintGet;
  readonly now?: () => Date;
};

export class PrintStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PrintStorageError";
  }
}

export function printObjectKey(printId: string): string {
  return `prints/${printId}.pdf`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Stores one PDF under prints/<printId>.pdf and returns the metadata the
 * success result needs. A retry writes the same key, so the operation is
 * idempotent for a given inbound message id.
 *
 * Encryption comes from the prints bucket's default SSE-KMS configuration with
 * the project CMK. The worker deliberately sends no per-object SSE header, so
 * LocalStack only needs SQS and S3.
 */
// ORCHID-MEM: 01a1c1d8-f292-7843-9137-1a7992a59d52 — Stores one PDF under prints/<printId>.pdf with SHA-256, size and a presigned GET.
export class S3PrintRepository implements PrintRepository {
  private readonly client: PrintObjectClient;
  private readonly bucket: string;
  private readonly presignTtlSeconds: number;
  private readonly presign: PresignPrintGet;
  private readonly now: () => Date;

  constructor(options: S3PrintRepositoryOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.presignTtlSeconds = options.presignTtlSeconds;
    this.presign = options.presign;
    this.now = options.now ?? (() => new Date());
  }

  async store(input: StorePrintInput): Promise<StoredPrint> {
    const key = printObjectKey(input.printId);
    const sha256 = sha256Hex(input.templateBytes);
    const sizeBytes = input.templateBytes.byteLength;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: input.templateBytes,
          ContentType: "application/pdf",
          ContentLength: sizeBytes,
        }),
      );
    } catch (error) {
      throw new PrintStorageError("failed to store print in S3", { cause: error });
    }

    const signedAt = this.now().getTime();
    let printing: string;
    try {
      printing = await this.presign({
        bucket: this.bucket,
        key,
        expiresIn: this.presignTtlSeconds,
      });
    } catch (error) {
      throw new PrintStorageError("failed to presign print GET URL", { cause: error });
    }

    const printingExpiresAt = new Date(signedAt + this.presignTtlSeconds * 1_000).toISOString();

    return { sha256, sizeBytes, printing, printingExpiresAt };
  }
}
