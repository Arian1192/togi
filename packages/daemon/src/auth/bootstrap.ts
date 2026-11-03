import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { UserId } from "@togi/core";
import type Database from "better-sqlite3";
import { paths } from "../config/app.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { authenticate, hashToken, newToken, type TokenRow } from "./tokens.ts";

export interface Bootstrapped {
  db: Database.Database;
  masterKey: Uint8Array;
  userId: UserId;
}

function readCredentials(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Primer arranque idempotente. Nunca se confía en un token que venga del disco: solo vale el que
 * tiene su hash en la base. Orden: hash en la base y después `credentials` (wx, 0600).
 */
export async function bootstrap(
  home: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Bootstrapped> {
  const p = paths(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const db = openEventDatabase(p.database);
  try {
    const masterKey = await loadOrCreateMasterKey(selectKeychain({ home, env }));
    const stored = readCredentials(p.credentials);
    const rows = db.prepare("SELECT token_hash, user_id FROM tokens").all() as TokenRow[];
    if (stored !== null && authenticate(stored, rows) === null) {
      throw new Error(`${p.credentials} no corresponde a ningún token registrado; no se toca nada`);
    }
    const row = db.prepare("SELECT user_id FROM users LIMIT 1").get() as
      | { user_id: UserId }
      | undefined;
    if (row !== undefined && stored !== null) return { db, masterKey, userId: row.user_id };

    const userId: UserId = row?.user_id ?? `usr_${randomBytes(16).toString("hex")}`;
    const token = newToken();
    const now = new Date().toISOString();
    db.transaction(() => {
      if (row === undefined)
        db.prepare("INSERT INTO users VALUES (?, ?, ?)").run(userId, "owner", now);
      db.prepare("DELETE FROM tokens WHERE user_id = ?").run(userId);
      db.prepare("INSERT INTO tokens VALUES (?, ?, ?)").run(hashToken(token), userId, now);
    })();
    writeFileSync(p.credentials, `${token}\n`, { flag: "wx", mode: 0o600 });
    return { db, masterKey, userId };
  } catch (error) {
    db.close();
    throw error;
  }
}
