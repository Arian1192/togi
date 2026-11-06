import { readFileSync } from "node:fs";
import { DEFAULT_FLOW } from "@togi/core";
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
import type { Notification } from "./notify/notifier.ts";
import type { PlannerSource } from "./orchestrator/claude-planner-factory.ts";
import { createOrchestrator } from "./orchestrator/orchestrator.ts";
import {
  PLANNER_ACTIVE,
  PLANNER_NOT_CONFIGURED,
  type PlannerStatus,
} from "./orchestrator/planner-status.ts";
import { SqliteEventStore } from "./store/event-store.ts";
import { AgentEventStore } from "./trajectory/agent-event-store.ts";

/** Arranca el daemon: primer arranque idempotente y API en el socket Unix. */
export async function startDaemon(
  home: string,
  env: Record<string, string | undefined> = process.env,
  /**
   * Un Planner, o una función que lo construye con lo que el daemon tiene al arrancar (esta lanza si
   * su configuración es inválida y el daemon no arranca). Nunca sale del entorno.
   */
  options: {
    planner?: PlannerSource;
    plannerStatus?: PlannerStatus;
    /** Avisos al usuario. Sin él no se notifica nada: lo pone `main.ts`, nunca los tests. */
    notify?: (notification: Notification) => void;
  } = {},
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
    const credentials = agentCredentials(selectSecretStore({ home, env }));
    const source = options.planner;
    const planner =
      typeof source === "function"
        ? source({
            db,
            home,
            store,
            readText: handle.readText,
            agentEvents,
            credentials,
            scrub: [token],
            env,
          })
        : source;
    // Con planificador construido por el daemon, el especialista sale del flujo por defecto.
    const flow = typeof source === "function" ? DEFAULT_FLOW : undefined;
    const plannerStatus =
      options.plannerStatus ?? (source === undefined ? PLANNER_NOT_CONFIGURED : PLANNER_ACTIVE);
    const orchestrator = createOrchestrator({
      db,
      store,
      handle,
      planner,
      flow,
      notify: options.notify,
    });
    await orchestrator.recover();
    orchestrator.start();
    const server = await listen(
      createApp(db, handle, { store, blobs, agentEvents }, home, credentials, plannerStatus).fetch,
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
