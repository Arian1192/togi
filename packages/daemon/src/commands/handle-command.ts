import {
  type Actor,
  type BlobRef,
  type BlobStore,
  decide as coreDecide,
  type DataClass,
  type DomainError,
  evolve,
  type FlowPolicy,
  isTaskEvent,
  type NewTaskEvent,
  NO_TASK,
  type Plan,
  type ReasonCategory,
  type RiskLevel,
  type SessionEndedInput,
  type SessionStarted,
  type StoredEvent,
  type TaskCommand,
  type TaskSource,
  type TaskView,
  toDomainEvent,
} from "@togi/core";
import type Database from "better-sqlite3";
import { applyProjections } from "../projections/index.ts";
import type { SqliteEventStore } from "../store/event-store.ts";

/** Marcador para comandos sobre una tarea inexistente: decide devuelve task_not_found antes de usarlo. */
const NO_REF: BlobRef = { hash: "hmac-sha256:", keyId: "", dataClass: "task_text" };

const POLICY: FlowPolicy = { maxProductionLines: 200, maxTotalLines: 500, maxFailedCycles: 3 };

/** Comando de create con los textos en claro; el handler los guarda como blobs. */
export interface CreateTaskInput {
  type: "create";
  title: string;
  description: string;
  acceptanceCriteria: string;
  risk: RiskLevel;
  repo: string;
  baseBranch: string;
  source: TaskSource;
}

/** Campo omitido: no se edita. Texto vacío o solo espacios: se borra (null). */
export interface EditTaskInput {
  type: "edit";
  number: number;
  title?: string;
  description?: string;
  acceptanceCriteria?: string;
}

export interface SubmitTaskInput {
  type: "submit";
  number: number;
}

export interface RejectTaskInput {
  type: "reject";
  number: number;
  category: ReasonCategory;
  text: string;
}

/** Sesión de planificación: el prompt y la política llegan en claro y se guardan como blobs `prompt`. */
export interface RequestPlanRetryInput {
  type: "requestPlanRetry";
  number: number;
}

export interface StartSessionInput {
  type: "startSession";
  number: number;
  session: Omit<SessionStarted, "prompt" | "policy"> & { prompt: string; policy: string };
}

export interface EndSessionInput {
  type: "endSession";
  number: number;
  session: SessionEndedInput;
}

/** El enfoque llega en claro y se guarda como blob `task_text`. */
export interface ProposePlanInput {
  type: "proposePlan";
  number: number;
  plan: Omit<Plan, "planVersion" | "sessionId" | "approach"> & { approach: string };
}

export interface ApprovePlanInput {
  type: "approvePlan";
  number: number;
  planVersion: number;
}

export interface PlanReasonInput {
  type: "requestPlanChanges" | "rejectPlan";
  number: number;
  planVersion: number;
  category: ReasonCategory;
  text: string;
}

export type CommandInput =
  | CreateTaskInput
  | EditTaskInput
  | SubmitTaskInput
  | RequestPlanRetryInput
  | RejectTaskInput
  | StartSessionInput
  | EndSessionInput
  | ProposePlanInput
  | ApprovePlanInput
  | PlanReasonInput;
type ExistingTaskInput = Exclude<CommandInput, CreateTaskInput>;

/** If-Match no coincide con la versión actual del stream. No se ha escrito nada. */
export interface PreconditionFailed {
  kind: "precondition_failed";
  current: number;
}

export type HandleResult =
  | { number: number; events: StoredEvent[] }
  | DomainError
  | PreconditionFailed;

export interface CommandOptions {
  /** Versión del stream que el cliente dice haber visto; solo aplica a tareas existentes. */
  ifMatch?: number;
  /** Se guarda como correlationId de los eventos. */
  correlationId?: string;
  /** Solo en create: se ejecuta en la transacción del append, tras la proyección. Si lanza, se revierte todo. */
  onCommit?: (stored: StoredEvent[], tx: Database.Database) => void;
}

export interface HandlerDeps {
  db: Database.Database;
  store: SqliteEventStore;
  blobs: BlobStore;
  clock?: () => Date;
  /** Solo para tests: el daemon real usa siempre el decider de core. */
  decide?: typeof coreDecide;
}

export function createHandler(deps: HandlerDeps) {
  const { db, store, blobs, clock = () => new Date(), decide = coreDecide } = deps;
  const reserve = db.prepare("INSERT INTO task_numbers (reserved_at) VALUES (?)");

  const putText = (text: string, taskId: number): Promise<BlobRef> =>
    blobs.put(new TextEncoder().encode(text), "task_text", taskId);
  const textBlob = async (text: string, taskId: number): Promise<BlobRef | null> =>
    text.trim() === "" ? null : putText(text, taskId);

  /** La vista sale SIEMPRE del stream, evento a evento; nunca de la proyección `tasks`. */
  const loadView = async (stream: string) => {
    let view: TaskView = NO_TASK;
    let version = 0;
    for await (const stored of store.readStream(stream)) {
      const event = toDomainEvent(stored);
      if (isTaskEvent(event)) view = evolve(view, event);
      version = stored.streamVersion;
    }
    return { view, version };
  };

  const correlate = (events: NewTaskEvent[], correlationId?: string): NewTaskEvent[] =>
    correlationId === undefined ? events : events.map((event) => ({ ...event, correlationId }));

  const create = async (
    actor: Actor,
    cmd: CreateTaskInput,
    opts: CommandOptions,
  ): Promise<HandleResult> => {
    // 1. Reserva en su propia transacción: si algo falla después, el número queda gastado.
    const at = clock().toISOString();
    const number = Number(reserve.run(at).lastInsertRowid);
    // 2. Blobs con el taskId reservado.
    const title = await putText(cmd.title, number);
    const description = await textBlob(cmd.description, number);
    const acceptanceCriteria = await textBlob(cmd.acceptanceCriteria, number);
    // 3-4. Una tarea nueva se decide sobre la vista de una tarea inexistente.
    const { type: _type, ...fields } = cmd;
    const decided = decide(
      NO_TASK,
      { ...fields, type: "create", title, description, acceptanceCriteria, actor, at },
      POLICY,
    );
    if (!Array.isArray(decided)) return decided;
    // 5. Log y proyección en la misma transacción; un VersionConflictError se propaga.
    const events = store.appendWithin(
      `task:${number}`,
      0,
      correlate(decided as NewTaskEvent[], opts.correlationId),
      (stored, tx) => {
        for (const event of stored) applyProjections(tx, toDomainEvent(event));
        opts.onCommit?.(stored, tx);
      },
    );
    return { number, events };
  };

  const modify = async (
    actor: Actor,
    cmd: ExistingTaskInput,
    opts: CommandOptions,
  ): Promise<HandleResult> => {
    const stream = `task:${cmd.number}`;
    const { view, version } = await loadView(stream);
    // Sin tarea, task_not_found gana: lo da decide más abajo.
    if (view.exists && opts.ifMatch !== undefined && opts.ifMatch !== version) {
      return { kind: "precondition_failed", current: version };
    }
    const at = clock().toISOString();
    // Se construye dos veces: en seco (marcadores, sin escribir blobs) y, si decide lo acepta, de
    // verdad. Así un comando rechazado no deja blobs; sin tarea, decide da task_not_found.
    const build = async (dry: boolean): Promise<TaskCommand> => {
      const put = async (text: string, dataClass: DataClass = "task_text") =>
        dry ? NO_REF : blobs.put(new TextEncoder().encode(text), dataClass, cmd.number);
      // Texto vacío => null: decide lo rechaza con su invalid_reason (y su precedencia).
      const blob = async (text: string) => (text.trim() === "" ? null : put(text));
      switch (cmd.type) {
        case "edit": {
          const changes: Extract<TaskCommand, { type: "edit" }>["changes"] = {};
          if (cmd.title !== undefined) changes.title = await put(cmd.title);
          if (cmd.description !== undefined) changes.description = await blob(cmd.description);
          if (cmd.acceptanceCriteria !== undefined) {
            changes.acceptanceCriteria = await blob(cmd.acceptanceCriteria);
          }
          return { type: "edit", actor, at, changes };
        }
        case "submit":
          return { type: "submit", actor, at };
        case "requestPlanRetry":
          return { type: "requestPlanRetry", actor, at };
        case "reject": {
          const reason = { category: cmd.category, text: await blob(cmd.text) };
          return { type: "reject", actor, at, reason };
        }
        case "startSession": {
          const { prompt, policy, ...rest } = cmd.session;
          const session = {
            ...rest,
            prompt: await put(prompt, "prompt"),
            policy: await put(policy, "prompt"),
          };
          return { type: "startSession", actor, at, session };
        }
        case "endSession":
          return { type: "endSession", actor, at, session: cmd.session };
        case "proposePlan": {
          const { approach, ...rest } = cmd.plan;
          return {
            type: "proposePlan",
            actor,
            at,
            plan: { ...rest, approach: await put(approach) },
          };
        }
        case "approvePlan":
          return { type: "approvePlan", actor, at, planVersion: cmd.planVersion };
        case "requestPlanChanges":
        case "rejectPlan": {
          const reason = { category: cmd.category, text: await blob(cmd.text) };
          return { type: cmd.type, actor, at, planVersion: cmd.planVersion, reason };
        }
      }
    };
    const dry = decide(view, await build(true), POLICY);
    if (!Array.isArray(dry)) return dry;
    const command = await build(false);
    const decided = decide(view, command, POLICY);
    if (!Array.isArray(decided)) return decided;
    const events = store.appendWithin(
      stream,
      version,
      correlate(decided as NewTaskEvent[], opts.correlationId),
      (stored, tx) => {
        for (const event of stored) applyProjections(tx, toDomainEvent(event));
      },
    );
    return { number: cmd.number, events };
  };

  function handleCommand(
    actor: Actor,
    cmd: CommandInput,
    opts: CommandOptions = {},
  ): Promise<HandleResult> {
    return cmd.type === "create" ? create(actor, cmd, opts) : modify(actor, cmd, opts);
  }

  /** Descifra un texto de tarea. Lanza si el blob no se puede leer (clave destruida o manipulado). */
  const readText = async (ref: BlobRef): Promise<string> =>
    new TextDecoder().decode(await blobs.get(ref));

  return Object.assign(handleCommand, { readText });
}
