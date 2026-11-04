import { randomUUID } from "node:crypto";
import type { Actor, SessionId, StoredEvent, Usage } from "@togi/core";
import type Database from "better-sqlite3";
import type { createHandler } from "../commands/handle-command.ts";
import type { SqliteEventStore } from "../store/event-store.ts";
import type { Planner } from "./planner.ts";

const system: Actor = { kind: "system", component: "adapter:planner" };
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };
const TASK_STREAM = /^task:(\d+)$/;

export interface OrchestratorDeps {
  db: Database.Database;
  store: SqliteEventStore;
  handle: ReturnType<typeof createHandler>;
  /** Sin Planner no se planifica nada: la tarea se queda en planning. */
  planner?: Planner | undefined;
}

/** Solo los eventos que piden planificar; sus propios eventos no coinciden con ninguno. */
const wantsPlanning = (e: StoredEvent): boolean =>
  e.type === "task.submitted" ||
  (e.type === "decision.recorded" &&
    (e.payload as { verdict?: string }).verdict === "request_changes");

/**
 * Planifica automáticamente, de una tarea en una. Reacciona a los eventos del store, vengan de donde
 * vengan, y lo escribe todo a través del handler de comandos: nunca añade eventos por su cuenta.
 */
export function createOrchestrator({ db, store, handle, planner }: OrchestratorDeps) {
  const queue: number[] = [];
  /** En cola o en curso: una tarea no se encola dos veces. */
  const pending = new Set<number>();
  let draining: Promise<void> | undefined;
  let unsubscribe: (() => void) | undefined;

  const registered = db.prepare(
    "SELECT 1 FROM repos r JOIN tasks t ON r.repo = t.repo WHERE t.number = ?",
  );
  const fail = (what: string, result: unknown) => {
    console.error(`orquestador: ${what}: ${JSON.stringify(result)}`);
  };

  const endSession = async (number: number, sessionId: SessionId, ok: boolean, usage: Usage) => {
    const ended = await handle(system, {
      type: "endSession",
      number,
      session: { sessionId, outcome: ok ? "completed" : "failed", usage, trajectoryEvents: 0 },
    });
    if (!("events" in ended)) fail(`no se cerró la sesión ${sessionId}`, ended);
  };

  const planOne = async (number: number) => {
    if (planner === undefined) return;
    const planVersion =
      (
        db
          .prepare("SELECT COALESCE(MAX(plan_version), 0) AS v FROM plans WHERE task_number = ?")
          .get(number) as { v: number }
      ).v + 1;
    const sessionId: SessionId = `ses_${randomUUID()}`;
    const started = await handle(system, {
      type: "startSession",
      number,
      session: {
        ...planner.identity,
        sessionId,
        role: "planner",
        cycle: null,
        workspaceId: null,
      },
    });
    if (!("events" in started))
      return fail(`no se inició la sesión de la tarea ${number}`, started);

    // El repo de la tarea tiene que estar registrado (togi repo add). El motivo aún no cabe en
    // session.ended: solo se registra en el log del daemon.
    if (registered.get(number) === undefined) {
      fail(`la tarea ${number} no se planifica`, "repo_not_registered");
      return endSession(number, sessionId, false, NO_USAGE);
    }
    let ok = false;
    let usage = NO_USAGE;
    try {
      const outcome = await planner.plan({ taskNumber: number, planVersion });
      usage = outcome.usage;
      if (outcome.ok) {
        const agent: Actor = { kind: "agent", sessionId, role: "planner" };
        const proposed = await handle(agent, { type: "proposePlan", number, plan: outcome.plan });
        ok = "events" in proposed;
        if (!ok) fail(`plan rechazado en la tarea ${number}`, proposed);
      } else {
        fail(`el planificador falló en la tarea ${number}`, outcome.reason);
      }
    } catch (error) {
      fail(`el planificador lanzó en la tarea ${number}`, String(error));
    }
    await endSession(number, sessionId, ok, usage);
  };

  const drain = async () => {
    await Promise.resolve();
    for (let number = queue.shift(); number !== undefined; number = queue.shift()) {
      try {
        await planOne(number);
      } catch (error) {
        fail(`error planificando la tarea ${number}`, String(error));
      } finally {
        pending.delete(number);
      }
    }
  };

  const enqueue = (number: number) => {
    if (planner === undefined || pending.has(number)) return;
    pending.add(number);
    queue.push(number);
    draining ??= drain().finally(() => {
      draining = undefined;
    });
  };

  return {
    /** Empieza a escuchar el log. Sin Planner no hace nada. */
    start() {
      if (planner === undefined || unsubscribe) return;
      unsubscribe = store.subscribe((event) => {
        const number = TASK_STREAM.exec(event.stream)?.[1];
        if (number !== undefined && wantsPlanning(event)) enqueue(Number(number));
      });
    },
    /**
     * Tras un reinicio: cierra como failed las sesiones que quedaron abiertas y vuelve a encolar las
     * tareas en planning sin sesión activa. Lo primero se hace siempre; lo segundo, solo con Planner.
     */
    async recover() {
      const open = db
        .prepare("SELECT session_id, task_number FROM sessions WHERE state = 'active'")
        .all() as { session_id: SessionId; task_number: number }[];
      for (const row of open) await endSession(row.task_number, row.session_id, false, NO_USAGE);
      const waiting = db
        .prepare("SELECT number FROM tasks WHERE state = 'planning' ORDER BY number")
        .all() as { number: number }[];
      for (const { number } of waiting) enqueue(number);
    },
    /** Espera a que la cola se vacíe. */
    async idle() {
      while (draining) await draining;
    },
    async close() {
      unsubscribe?.();
      unsubscribe = undefined;
      await this.idle();
    },
  };
}
