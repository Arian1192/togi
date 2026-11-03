import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const newToken = (): string => randomBytes(32).toString("base64url");

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export interface TokenRow {
  token_hash: string;
  user_id: string;
}

/** Devuelve el usuario del token. Recorre todas las filas sin cortar al primer acierto. */
export function authenticate(token: string, rows: readonly TokenRow[]): string | null {
  const received = Buffer.from(hashToken(token), "hex");
  let userId: string | null = null;
  for (const row of rows) {
    if (timingSafeEqual(received, Buffer.from(row.token_hash, "hex"))) userId = row.user_id;
  }
  return userId;
}
