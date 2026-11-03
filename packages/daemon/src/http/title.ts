import type { BlobRef } from "@togi/core";
import type Database from "better-sqlite3";

/** Descifra un blob de texto; lanza si no se puede leer. */
export type TextReader = (ref: BlobRef) => Promise<string>;

export const ERASED_TITLE = "[borrado]";

/**
 * Descifra el título de una tarea. Cuenta como borrado SOLO si su clave de datos ya no existe;
 * cualquier otro fallo al leer (manipulación, fichero ausente, disco) lanza: es un error de
 * integridad, no un borrado.
 */
export function titleReader(db: Database.Database) {
  const keyExists = db.prepare("SELECT 1 FROM data_keys WHERE key_id = ?");
  return async (read: TextReader, ref: BlobRef): Promise<string> =>
    keyExists.get(ref.keyId) === undefined ? ERASED_TITLE : read(ref);
}
