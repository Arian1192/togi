import { randomBytes } from "node:crypto";
import type { Keychain } from "./keychain.ts";

/** Devuelve la clave maestra; la crea solo si `get` confirma que no existe. Un fallo de `get` lanza. */
export async function loadOrCreateMasterKey(keychain: Keychain): Promise<Uint8Array> {
  const existing = await keychain.get();
  if (existing !== null) return existing;
  const key = randomBytes(32);
  await keychain.create(key);
  return key;
}
