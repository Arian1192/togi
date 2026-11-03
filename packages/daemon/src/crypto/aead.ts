import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

type Aad = Uint8Array | string;

function checkKey(key: Uint8Array): void {
  if (key.length !== 32) throw new Error("la clave AES-256-GCM debe tener 32 bytes");
}

/**
 * Cifra con AES-256-GCM. Nonce aleatorio de 12 bytes en cada llamada. Formato:
 * `nonce ‖ tag ‖ ciphertext`. El AAD liga el resultado a su contexto.
 */
export function seal(key: Uint8Array, plain: Uint8Array, aad: Aad): Uint8Array {
  checkKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

/** Descifra lo producido por `seal`. Lanza si la clave, el AAD o cualquier byte no coinciden. */
export function open(key: Uint8Array, sealed: Uint8Array, aad: Aad): Uint8Array {
  checkKey(key);
  if (sealed.length < NONCE_BYTES + TAG_BYTES) throw new Error("dato cifrado demasiado corto");
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(sealed.subarray(NONCE_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}
