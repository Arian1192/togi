import type { BlobRef, DataClass } from "../model/blob.ts";
import type { TaskId } from "../model/ids.ts";

export interface BlobStore {
  put(bytes: Uint8Array, dataClass: DataClass, taskId: TaskId): Promise<BlobRef>;
  get(ref: BlobRef): Promise<Uint8Array>;
  shred(keyId: string): Promise<void>;
}
