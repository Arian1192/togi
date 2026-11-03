import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, SCHEMA_V1_SQL, SCHEMA_VERSION } from "./schema.ts";

/**
 * Abre (o crea) la base del event store. El fichero se crea con 0600 antes de abrirlo: SQLite
 * da a `-wal` y `-shm` los permisos del fichero principal.
 */
export function openEventDatabase(
  path: string,
  migrations: Readonly<Record<number, string>> = MIGRATIONS,
): Database.Database {
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
  if (version < SCHEMA_VERSION) {
    try {
      db.transaction(() => {
        if (version === 0) {
          db.exec(SCHEMA_V1_SQL);
          db.pragma("user_version = 1");
        }
        for (let target = Math.max(version, 1) + 1; target <= SCHEMA_VERSION; target++) {
          const sql = migrations[target];
          if (sql === undefined) throw new Error(`falta la migración a la versión ${target}`);
          db.exec(sql);
          db.pragma(`user_version = ${target}`);
        }
      })();
    } catch (error) {
      db.close();
      throw error;
    }
  }
  return db;
}
