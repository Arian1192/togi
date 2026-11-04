import { bootstrap } from "./auth/bootstrap.ts";
import { FileBlobStore } from "./blobs/file-blob-store.ts";
import { createHandler } from "./commands/handle-command.ts";
import { paths } from "./config/app.ts";
import { createApp } from "./http/app.ts";
import { listen } from "./http/listen.ts";
import { DataKeyring } from "./keys/data-keys.ts";
import { createOrchestrator } from "./orchestrator/orchestrator.ts";
import type { Planner } from "./orchestrator/planner.ts";
import { SqliteEventStore } from "./store/event-store.ts";

/** Arranca el daemon: primer arranque idempotente y API en el socket Unix. */
export async function startDaemon(
  home: string,
  env: Record<string, string | undefined> = process.env,
  /** Solo los tests pasan uno; en producción no hay ninguno hasta el PR 16. Nunca sale del entorno. */
  options: { planner?: Planner } = {},
) {
  const { db, masterKey, userId } = await bootstrap(home, env);
  try {
    const p = paths(home);
    const blobs = new FileBlobStore(p.blobs, new DataKeyring(db, masterKey));
    const store = new SqliteEventStore(db);
    const handle = createHandler({ db, store, blobs });
    const orchestrator = createOrchestrator({ db, store, handle, planner: options.planner });
    await orchestrator.recover();
    orchestrator.start();
    const server = await listen(createApp(db, handle, { store, blobs }, home).fetch, p.socket);
    return {
      userId,
      db,
      async close() {
        await server.close();
        await orchestrator.close();
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
