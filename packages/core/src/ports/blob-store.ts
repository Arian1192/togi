import type { BlobRef, DataClass } from "../model/blob.ts";
import type { UserId } from "../model/ids.ts";

export interface BlobStore {
  put(bytes: Uint8Array, dataClass: DataClass, subject?: UserId): Promise<BlobRef>;
  get(ref: BlobRef): Promise<Uint8Array>;
  shred(keyId: string): Promise<void>;
}
