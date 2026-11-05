import type { BlobRef, BlobStore } from "@togi/core";
import {
  type DomainEvent,
  EventParseError,
  evolve,
  isTaskEvent,
  NO_TASK,
  TASK_STATES,
  type TaskState,
  type TaskView,
  toDomainEvent,
} from "@togi/core";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { SqliteEventStore } from "../store/event-store.ts";
import type { AgentEventStore } from "../trajectory/agent-event-store.ts";
import type { AppEnv } from "./app.ts";
import { problem } from "./problem.ts";
import { NUMBER } from "./tasks.ts";
import { type TextReader, titleReader } from "./title.ts";

export interface ReadDeps {
  store: SqliteEventStore;
  blobs: BlobStore;
  /** Trayectoria de los agentes: `verify-log` nunca da ok sin mirarla. */
  agentEvents: AgentEventStore;
  /** Intervalo del latido del SSE; 15 s por defecto. */
  heartbeatMs?: number;
}

const LIMIT = /^\d+$/;

interface TaskRow {
  number: number;
  title: string;
  state: string;
  risk: string;
  repo: string;
  base_branch: string;
  has_criteria: number;
  stream_version: number;
  created_at: string;
  updated_at: string;
}

type Text = { text: string | null; erased: boolean };

/**
 * Consultas del ADR-005, encadenadas para que `hc` infiera sus tipos. El detalle sin `reads`
 * responde 503. Un texto cuenta como borrado SOLO si su clave de datos ya no existe; cualquier otro
 * fallo al leer el blob (manipulación, fichero ausente, disco) es un error de integridad.
 */
export function queryRoutes(
  db: Database.Database,
  reads: ReadDeps | undefined,
  handle?: { readText: TextReader },
) {
  // Sin `reads` el descifrado llega por el manejador de comandos.
  const textReader = (): TextReader | undefined =>
    handle?.readText ??
    (reads === undefined
      ? undefined
      : async (ref) => new TextDecoder().decode(await reads.blobs.get(ref)));
  const titleOf = titleReader(db);
  const list = (state: string | undefined, limit: number) =>
    db
      .prepare(
        `SELECT number, title, state, risk, repo, base_branch, has_criteria, stream_version, updated_at FROM tasks
         ${state === undefined ? "" : "WHERE state = ?"} ORDER BY number LIMIT ?`,
      )
      .all(...(state === undefined ? [limit] : [state, limit])) as TaskRow[];
  const keyExists = db.prepare("SELECT 1 FROM data_keys WHERE key_id = ?");

  const read = async (blobs: BlobStore, ref: BlobRef | null): Promise<Text> => {
    if (ref === null) return { text: null, erased: false };
    if (keyExists.get(ref.keyId) === undefined) return { text: null, erased: true };
    return { text: new TextDecoder().decode(await blobs.get(ref)), erased: false };
  };

  // Todos los eventos de la tarea validados, o ninguno: un evento corrupto es un error de
  // integridad con su seq, nunca una lista parcial. Un stream vacío es una tarea inexistente.
  const loadEvents = async (store: SqliteEventStore, n: string) => {
    const events: DomainEvent[] = [];
    let version = 0;
    for await (const stored of store.readStream(`task:${n}`)) {
      events.push(toDomainEvent(stored));
      version = stored.streamVersion;
    }
    return { events, version };
  };
  const corrupt = (e: unknown) =>
    e instanceof EventParseError
      ? problem(500, "integrity_error", "un evento del log no es válido", {}, { seq: e.seq })
      : undefined;

  return new Hono<AppEnv>()
    .get("/v1/tasks", async (c) => {
      const state = c.req.query("state");
      if (state !== undefined && !TASK_STATES.includes(state as TaskState)) {
        return problem(400, "validation_error", `state debe ser uno de ${TASK_STATES.join(", ")}`);
      }
      const raw = c.req.query("limit") ?? "50";
      const limit = LIMIT.test(raw) ? Number(raw) : 0;
      if (limit < 1 || limit > 200) {
        return problem(400, "validation_error", "limit debe ser un entero entre 1 y 200");
      }
      const reader = textReader();
      if (reader === undefined) return problem(503, "not_configured", "consultas no disponibles");
      try {
        const tasks = await Promise.all(
          list(state, limit).map(async (r) => ({
            number: r.number,
            ...(await titleOf(reader, JSON.parse(r.title) as BlobRef)),
            state: r.state,
            risk: r.risk,
            repo: r.repo,
            baseBranch: r.base_branch,
            hasCriteria: r.has_criteria === 1,
            updatedAt: r.updated_at,
            version: r.stream_version,
          })),
        );
        return c.json({ tasks });
      } catch {
        return problem(500, "integrity_error", "no se pudo leer un título de tarea");
      }
    })
    .get("/v1/tasks/:n", async (c) => {
      if (reads === undefined) return problem(503, "not_configured", "consultas no disponibles");
      const param = c.req.param("n");
      if (!NUMBER.test(param)) return problem(404, "task_not_found", "tarea inexistente");
      let view: TaskView = NO_TASK;
      let version: number;
      try {
        const loaded = await loadEvents(reads.store, param);
        version = loaded.version;
        for (const event of loaded.events) {
          if (isTaskEvent(event)) view = evolve(view, event);
        }
      } catch (e) {
        const res = corrupt(e);
        if (res === undefined) throw e;
        return res;
      }
      if (!view.exists) return problem(404, "task_not_found", "tarea inexistente");
      try {
        const title = await titleOf(textReader() as TextReader, view.title);
        const description = await read(reads.blobs, view.description);
        const criteria = await read(reads.blobs, view.acceptanceCriteria);
        const dates = db
          .prepare("SELECT repo, base_branch, created_at, updated_at FROM tasks WHERE number = ?")
          .get(Number(param)) as Pick<
          TaskRow,
          "repo" | "base_branch" | "created_at" | "updated_at"
        >;
        c.header("etag", `"${version}"`);
        return c.json({
          number: Number(param),
          ...title,
          state: view.state,
          risk: view.risk,
          repo: dates.repo,
          baseBranch: dates.base_branch,
          createdAt: dates.created_at,
          updatedAt: dates.updated_at,
          version,
          planVersion: view.planning?.planVersion || null,
          description: description.text,
          acceptanceCriteria: criteria.text,
          erased: { description: description.erased, acceptanceCriteria: criteria.erased },
        });
      } catch {
        return problem(500, "integrity_error", "no se pudo leer un texto de la tarea");
      }
    })
    .get("/v1/tasks/:n/events", async (c) => {
      if (reads === undefined) return problem(503, "not_configured", "consultas no disponibles");
      const param = c.req.param("n");
      if (!NUMBER.test(param)) return problem(404, "task_not_found", "tarea inexistente");
      try {
        const { events } = await loadEvents(reads.store, param);
        if (events.length === 0) return problem(404, "task_not_found", "tarea inexistente");
        return c.json({ events });
      } catch (e) {
        const res = corrupt(e);
        if (res === undefined) throw e;
        return res;
      }
    });
}
