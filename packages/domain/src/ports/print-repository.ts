export type StorePrintInput = {
  readonly printId: string;
  readonly templateBytes: Uint8Array;
};

export type StoredPrint = {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly printing: string;
  readonly printingExpiresAt: string;
};

export interface PrintRepository {
  store(input: StorePrintInput): Promise<StoredPrint>;
}
