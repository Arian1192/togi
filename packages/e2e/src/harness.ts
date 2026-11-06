// Único paquete que puede importar los helpers de la CLI y las funciones internas del daemon por
// ruta relativa: ni `@togi/cli` ni `@togi/daemon` las exportan, y no deben hacerlo.
import { request } from "node:http";
import { erase } from "../../daemon/src/blobs/erase.ts";
import { FileBlobStore } from "../../daemon/src/blobs/file-blob-store.ts";
import { paths } from "../../daemon/src/config/app.ts";
import { DataKeyring } from "../../daemon/src/keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../../daemon/src/keys/master-key.ts";
import { selectKeychain } from "../../daemon/src/keys/select-keychain.ts";
import { openEventDatabase } from "../../daemon/src/store/database.ts";
import { SqliteEventStore } from "../../daemon/src/store/event-store.ts";

// Los e2e prueban el flujo sin agente: el daemon que arrancan hereda este entorno.
process.env.TOGI_PLANNER = "off";

export { type CliResult, runCli } from "../../cli/src/testing/run-cli.ts";
export { type RunningCli, spawnCli } from "../../cli/src/testing/spawn-cli.ts";
export { paths };

/** Abre la base del home (con el daemon parado) y la cierra siempre al terminar. */
export async function withDatabase<T>(
  home: string,
  fn: (db: ReturnType<typeof openEventDatabase>) => T | Promise<T>,
): Promise<T> {
  const db = openEventDatabase(paths(home).database);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

/** `erase` de `task_text` con las funciones del daemon, porque la CLI no tiene comando. */
export async function eraseTaskText(home: string, taskId: number): Promise<string | null> {
  const keychain = selectKeychain({ home, env: { TOGI_KEYCHAIN: "file" } });
  const master = await loadOrCreateMasterKey(keychain);
  return withDatabase(home, (db) => {
    const keys = new DataKeyring(db, master);
    const blobs = new FileBlobStore(paths(home).blobs, keys);
    const actor = { kind: "human", userId: "usr_e2e" } as const;
    return erase(
      { events: new SqliteEventStore(db), keys, blobs },
      taskId,
      "task_text",
      "e2e",
      actor,
    );
  });
}

/** Petición cruda al socket; `authorization` ausente = sin cabecera. */
export function rawRequest(home: string, path: string, authorization?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers = authorization === undefined ? {} : { authorization };
    request({ socketPath: paths(home).socket, path, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    })
      .on("error", reject)
      .end();
  });
}
