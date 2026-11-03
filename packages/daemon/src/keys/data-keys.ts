import { hkdfSync, randomBytes } from "node:crypto";
import type { DataClass, TaskId } from "@togi/core";
import type Database from "better-sqlite3";
import { open, seal } from "../crypto/aead.ts";

const ENC_INFO = "togi/blob-enc/v1";
const ID_INFO = "togi/blob-id/v1";

export interface DataKey {
  keyId: string;
  /** Cifra los blobs. */
  enc: Uint8Array;
  /** Calcula el identificador (HMAC); distinta de `enc`. */
  mac: Uint8Array;
}

interface Row {
  key_id: string;
  task_id: number;
  data_class: string;
  wrapped_key: Buffer;
}

const derive = (key: Uint8Array, info: string): Uint8Array =>
  new Uint8Array(hkdfSync("sha256", key, new Uint8Array(0), info, 32));

/** El AAD liga la clave envuelta a su fila: copiarla a otra no la desenvuelve. */
const wrapAad = (keyId: string, taskId: number, dataClass: string): string =>
  `togi/data-key/v1|${keyId}|${taskId}|${dataClass}`;

/** Claves de datos por tarea y clase, envueltas con la clave maestra en `data_keys`. */
export class DataKeyring {
  readonly #db: Database.Database;
  readonly #master: Uint8Array;

  constructor(db: Database.Database, masterKey: Uint8Array) {
    this.#db = db;
    this.#master = masterKey;
    // Un DELETE pone a cero la página: sin esto la clave envuelta sobreviviría en el fichero.
    db.pragma("secure_delete = ON");
  }

  /** Id de la clave de la tarea y la clase, o `undefined` si no existe (no la crea). */
  find(taskId: TaskId, dataClass: DataClass): string | undefined {
    const row = this.#db
      .prepare("SELECT key_id FROM data_keys WHERE task_id = ? AND data_class = ?")
      .get(taskId, dataClass) as { key_id: string } | undefined;
    return row?.key_id;
  }

  /** Borra la clave envuelta. Devuelve si existía. Síncrona: cabe dentro de una transacción. */
  destroy(keyId: string): boolean {
    return this.#db.prepare("DELETE FROM data_keys WHERE key_id = ?").run(keyId).changes > 0;
  }

  /** Vuelca el WAL al fichero y lo vacía, para que los bytes borrados no queden en `-wal`. */
  checkpoint(): void {
    const result = this.#db.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[];
    if (result[0]?.busy !== 0) throw new Error("checkpoint del WAL incompleto: base ocupada");
  }

  /** Devuelve la clave de la tarea y la clase; la crea la primera vez. */
  keyFor(taskId: TaskId, dataClass: DataClass): DataKey {
    const find = this.#db.prepare("SELECT * FROM data_keys WHERE task_id = ? AND data_class = ?");
    let row = find.get(taskId, dataClass) as Row | undefined;
    if (row === undefined) {
      const keyId = `key_${randomBytes(16).toString("hex")}`;
      const wrapped = seal(this.#master, randomBytes(32), wrapAad(keyId, taskId, dataClass));
      this.#db
        .prepare(
          "INSERT OR IGNORE INTO data_keys (key_id, task_id, data_class, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(keyId, taskId, dataClass, wrapped, new Date().toISOString());
      row = find.get(taskId, dataClass) as Row;
    }
    return this.#unwrap(row);
  }

  /** Recupera una clave por su id. Lanza si no existe (p. ej. destruida) o no desenvuelve. */
  unwrap(keyId: string): DataKey {
    const row = this.#db.prepare("SELECT * FROM data_keys WHERE key_id = ?").get(keyId) as
      | Row
      | undefined;
    if (row === undefined) throw new Error(`clave de datos inexistente o destruida: ${keyId}`);
    return this.#unwrap(row);
  }

  #unwrap(row: Row): DataKey {
    const aad = wrapAad(row.key_id, row.task_id, row.data_class);
    const dataKey = open(this.#master, row.wrapped_key, aad);
    return { keyId: row.key_id, enc: derive(dataKey, ENC_INFO), mac: derive(dataKey, ID_INFO) };
  }
}
