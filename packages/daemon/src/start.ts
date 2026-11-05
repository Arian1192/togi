import { readFileSync } from "node:fs";
import { bootstrap } from "./auth/bootstrap.ts";
import { FileBlobStore } from "./blobs/file-blob-store.ts";
import { RedactingBlobStore } from "./blobs/redacting-blob-store.ts";
import { createHandler } from "./commands/handle-command.ts";
import { paths } from "./config/app.ts";
import { agentCredentials } from "./credentials/agent-credential.ts";
import { createApp } from "./http/app.ts";
import { listen } from "./http/listen.ts";
import { DataKeyring } from "./keys/data-keys.ts";
import { selectSecretStore } from "./keys/select-keychain.ts";
import { createOrchestrator } from "./orchestrator/orchestrator.ts";
import type { Planner } from "./orchestrator/planner.ts";
import { SqliteEventStore } from "./store/event-store.ts";
import { AgentEventStore } from "./trajectory/agent-event-store.ts";

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
    // El token de togi nunca debe acabar en un prompt ni en una trayectoria.
    const token = readFileSync(p.credentials, "utf8").trim();
    const blobs = new RedactingBlobStore(
      new FileBlobStore(p.blobs, new DataKeyring(db, masterKey)),
      [token],
    );
    const store = new SqliteEventStore(db);
    const agentEvents = new AgentEventStore(db, blobs);
    const handle = createHandler({ db, store, blobs });
    const orchestrator = createOrchestrator({ db, store, handle, planner: options.planner });
    await orchestrator.recover();
    orchestrator.start();
    const server = await listen(
      createApp(
        db,
        handle,
        { store, blobs, agentEvents },
        home,
        agentCredentials(selectSecretStore({ home, env })),
      ).fetch,
      p.socket,
    );
    return {
      userId,
      db,
      blobs,
      agentEvents,
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
