import { randomUUID } from "node:crypto";
import {
  type Actor,
  BUILTIN_SPECIALISTS,
  EventParseError,
  FAILURE_REASONS,
  type FailureReason,
  type FlowConfig,
  planningProducer,
  type SessionId,
  type Specialist,
  type StoredEvent,
  specialistHash,
  type Usage,
  VersionConflictError,
} from "@togi/core";
import type Database from "better-sqlite3";
import type { createHandler } from "../commands/handle-command.ts";
import { stripControl } from "../redaction/control-chars.ts";
import { redact } from "../redaction/redact.ts";
import { publishBuiltinSpecialists } from "../specialists/publish-builtin.ts";
import type { SqliteEventStore } from "../store/event-store.ts";
import type { Planner, PlannerIdentity } from "./planner.ts";

const system: Actor = { kind: "system", component: "adapter:planner" };
const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, durationMs: 0 };
const TASK_STREAM = /^task:(\d+)$/;

export interface OrchestratorDeps {
  db: Database.Database;
  store: SqliteEventStore;
  handle: ReturnType<typeof createHandler>;
  /** Sin Planner no se planifica nada: la tarea se queda en planning. */
  planner?: Planner | undefined;
  /**
   * El recorrido (ADR-009): quién ocupa la planificación. Con flujo, el especialista se publica
   * antes de la primera sesión y la sesión registra su versión y su hash. Sin flujo, manda el Planner.
   */
  flow?: FlowConfig | undefined;
  catalog?: readonly Specialist[] | undefined;
}

/** Solo los eventos que piden planificar; sus propios eventos no coinciden con ninguno. */
const wantsPlanning = (e: StoredEvent): boolean =>
  e.type === "task.submitted" ||
  e.type === "plan.retry_requested" ||
  (e.type === "decision.recorded" &&
    (e.payload as { verdict?: string }).verdict === "request_changes");

/**
 * Planifica automáticamente, de una tarea en una. Reacciona a los eventos del store, vengan de donde
 * vengan, y lo escribe todo a través del handler de comandos: nunca añade eventos por su cuenta.
 */
export function createOrchestrator({
  db,
  store,
  handle,
  planner,
  flow,
  catalog = BUILTIN_SPECIALISTS,
}: OrchestratorDeps) {
  const queue: number[] = [];
  /** Los especialistas ya publicados (y comprobados) en esta ejecución. */
  const published = new Set<Specialist>();
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

  /** `failure` es el motivo si la sesión falló; `null` si completó. */
  const endSession = async (
    number: number,
    sessionId: SessionId,
    failure: FailureReason | null,
    usage: Usage,
    trajectoryEvents = 0,
  ) => {
    const ended = await handle(system, {
      type: "endSession",
      number,
      session: {
        sessionId,
        outcome: failure === null ? "completed" : "failed",
        usage,
        trajectoryEvents,
        failureReason: failure,
      },
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
    // Sin sesión abierta no hay motivo que registrar: si algo falla aquí, solo queda en el log.
    const sessionId: SessionId = `ses_${randomUUID()}`;
    let producer: Specialist | undefined;
    if (flow !== undefined) {
      producer = planningProducer(flow, catalog);
      if (producer === undefined) {
        return fail(
          `la tarea ${number} no se planifica`,
          "el flujo nombra un especialista que no existe",
        );
      }
      if (!published.has(producer)) {
        try {
          await publishBuiltinSpecialists(store, [producer]);
          published.add(producer);
        } catch (error) {
          const { id, version } = producer;
          return fail(
            `la tarea ${number} no se planifica: ${id}@${version} cambió sin subir de versión; publícalo como ${id}@${version + 1}`,
            String(error),
          );
        }
      }
    }
    const request = { taskNumber: number, planVersion, sessionId, specialist: producer };
    let identity: PlannerIdentity;
    try {
      identity =
        typeof planner.identity === "function" ? await planner.identity(request) : planner.identity;
    } catch (error) {
      return fail(`la tarea ${number} no se planifica`, String(error));
    }
    if (producer !== undefined) {
      const { id, version } = producer;
      identity = { ...identity, specialist: { id, version, hash: specialistHash(producer) } };
    }
    const startSession = () =>
      handle(system, {
        type: "startSession",
        number,
        session: {
          ...identity,
          sessionId,
          role: "planner",
          cycle: null,
          workspaceId: null,
        },
      });
    // Una persona puede escribir en el stream de la tarea (otro `plan retry`) justo mientras se
    // abre la sesión: se vuelve a decidir sobre el estado nuevo en vez de perder la planificación.
    const started = await startSession().catch((error: unknown) => {
      if (error instanceof VersionConflictError) return startSession();
      throw error;
    });
    if (!("events" in started))
      return fail(`no se inició la sesión de la tarea ${number}`, started);

    // El repo de la tarea tiene que estar registrado (togi repo add). El motivo aún no cabe en
    // session.ended: solo se registra en el log del daemon.
    if (registered.get(number) === undefined) {
      fail(`la tarea ${number} no se planifica`, "repo_not_registered");
      return endSession(number, sessionId, "repo_not_registered", NO_USAGE);
    }
    let failure: FailureReason | null = "planner_failed";
    let usage = NO_USAGE;
    let trajectoryEvents = 0;
    try {
      const outcome = await planner.plan(request);
      usage = outcome.usage;
      trajectoryEvents = outcome.trajectoryEvents ?? 0;
      if (outcome.ok) {
        const agent: Actor = { kind: "agent", sessionId, role: "planner" };
        // Un plan que no cumple el esquema (ruta insegura, por ejemplo) lanza EventParseError: es un
        // plan inválido, no un fallo del planificador. Cualquier otro error sube al catch de abajo.
        const proposed = await handle(agent, {
          type: "proposePlan",
          number,
          plan: outcome.plan,
        }).catch((error: unknown) => {
          if (error instanceof EventParseError) return error;
          throw error;
        });
        failure = "events" in proposed ? null : "invalid_plan";
        if (failure) fail(`plan rechazado en la tarea ${number}`, String(proposed));
      } else {
        // Un código fuera de la lista cerrada (un adaptador que se salta el tipo) nunca llega al evento.
        failure = FAILURE_REASONS.find((c) => c === outcome.code) ?? "planner_failed";
        // El motivo lleva las líneas de diagnóstico del agente; se limpian aquí otra vez, porque
        // daemon.log no debe recibir nada que el detector de secretos reconozca.
        fail(
          `el planificador falló en la tarea ${number} (${failure})`,
          stripControl(redact(outcome.reason)),
        );
      }
    } catch (error) {
      failure = "planner_error";
      fail(`el planificador lanzó en la tarea ${number}`, String(error));
    }
    await endSession(number, sessionId, failure, usage, trajectoryEvents);
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
      for (const row of open)
        await endSession(row.task_number, row.session_id, "daemon_restarted", NO_USAGE);
      // Solo las tareas sin sesión, con la última completada (petición de cambios) o cortada por el
      // reinicio. Una que falló se reintenta a mano (`togi plan retry`): relanzar un agente real en
      // cada arranque costaría dinero sin que nadie lo pida.
      const waiting = db
        .prepare(
          `SELECT t.number FROM tasks t WHERE t.state = 'planning' AND NOT EXISTS (
             SELECT 1 FROM sessions s WHERE s.task_number = t.number
               AND s.failure_reason IS NOT NULL AND s.failure_reason <> 'daemon_restarted'
               AND s.rowid = (SELECT MAX(rowid) FROM sessions WHERE task_number = t.number)
           ) ORDER BY t.number`,
        )
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
