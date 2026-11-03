import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

/**
 * Abre (o crea) la base del event store. El fichero se crea con 0600 antes de abrirlo: SQLite
 * da a `-wal` y `-shm` los permisos del fichero principal.
 */
export function openEventDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    closeSync(openSync(path, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(`esquema ${version} más nuevo que el soportado (${SCHEMA_VERSION})`);
  }
  if (version === 0) {
    db.transaction(() => {
      db.exec(SCHEMA_SQL);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }
  return db;
}
