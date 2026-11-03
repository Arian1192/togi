import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BlobRef, BlobStore, DataClass, TaskId } from "@togi/core";
import { open, seal } from "../crypto/aead.ts";
import type { DataKeyring } from "../keys/data-keys.ts";

const PREFIX = "hmac-sha256:";
const KEY_ID = /^key_[0-9a-f]{32}$/;
const BLOB_ID = /^[0-9a-f]{64}$/;

const aadFor = (keyId: string, id: string): string => `togi/blob/v1|${keyId}|${id}`;

/** Blobs cifrados en `<root>/<keyId>/<identificador>`; el identificador es un HMAC del claro. */
export class FileBlobStore implements BlobStore {
  readonly #root: string;
  readonly #keys: DataKeyring;

  constructor(root: string, keys: DataKeyring) {
    this.#root = root;
    this.#keys = keys;
  }

  async put(bytes: Uint8Array, dataClass: DataClass, taskId: TaskId): Promise<BlobRef> {
    const key = this.#keys.keyFor(taskId, dataClass);
    const id = createHmac("sha256", key.mac).update(bytes).digest("hex");
    const dir = join(this.#root, key.keyId);
    const target = join(dir, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await exists(target))) {
      const tmp = join(dir, `.${id}.${randomBytes(6).toString("hex")}.tmp`);
      try {
        await writeFile(tmp, seal(key.enc, bytes, aadFor(key.keyId, id)), {
          flag: "wx",
          mode: 0o600,
        });
        await rename(tmp, target);
      } catch (error) {
        await unlink(tmp).catch(() => undefined);
        throw error;
      }
    }
    return { hash: `${PREFIX}${id}`, keyId: key.keyId, dataClass };
  }

  async get(ref: BlobRef): Promise<Uint8Array> {
    const id = ref.hash.startsWith(PREFIX) ? ref.hash.slice(PREFIX.length) : "";
    if (!BLOB_ID.test(id) || !KEY_ID.test(ref.keyId))
      throw new Error("referencia de blob inválida");
    const key = this.#keys.unwrap(ref.keyId);
    const sealed = await readFile(join(this.#root, ref.keyId, id));
    const plain = open(key.enc, sealed, aadFor(ref.keyId, id));
    const mac = createHmac("sha256", key.mac).update(plain).digest();
    if (!timingSafeEqual(mac, Buffer.from(id, "hex")))
      throw new Error("el blob no coincide con su identificador");
    return plain;
  }

  async shred(_keyId: string): Promise<void> {
    throw new Error("no implementado hasta 6c-2");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
