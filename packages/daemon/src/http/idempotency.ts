import { createHash } from "node:crypto";
import { canonicalize } from "@togi/core";
import type Database from "better-sqlite3";

export interface SavedResponse {
  request_hash: string;
  status: number;
  response_body: string;
}

/** SHA-256 del cuerpo JSON canonicalizado: el orden de las claves no cambia la huella. */
export const hashBody = (json: unknown): string =>
  createHash("sha256").update(canonicalize(json)).digest("hex");

/** Claves de idempotencia por usuario. `save` va dentro de la transacción del append. */
export function idempotencyKeys(db: Database.Database) {
  const find = db.prepare(
    "SELECT request_hash, status, response_body FROM idempotency_keys WHERE user_id = ? AND key = ?",
  );
  return {
    find: (userId: string, key: string) => find.get(userId, key) as SavedResponse | undefined,
    save: (tx: Database.Database, userId: string, key: string, saved: SavedResponse) =>
      tx
        .prepare("INSERT INTO idempotency_keys VALUES (?, ?, ?, ?, ?, ?)")
        .run(
          userId,
          key,
          saved.request_hash,
          saved.status,
          saved.response_body,
          new Date().toISOString(),
        ),
  };
}
