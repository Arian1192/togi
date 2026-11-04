import {
  type Actor,
  type BlobRef,
  type BlobStore,
  decide as coreDecide,
  type DomainError,
  evolve,
  type FlowPolicy,
  type NewTaskEvent,
  NO_TASK,
  type ReasonCategory,
  type RiskLevel,
  type StoredEvent,
  type TaskCommand,
  type TaskSource,
  type TaskView,
  toDomainEvent,
} from "@togi/core";
import type Database from "better-sqlite3";
import { applyProjections } from "../projections/index.ts";
import type { SqliteEventStore } from "../store/event-store.ts";

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

export type CommandInput = CreateTaskInput | EditTaskInput | SubmitTaskInput | RejectTaskInput;

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
      if (event.type !== "data.erased") view = evolve(view, event);
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
    cmd: EditTaskInput | SubmitTaskInput | RejectTaskInput,
    opts: CommandOptions,
  ): Promise<HandleResult> => {
    const stream = `task:${cmd.number}`;
    const { view, version } = await loadView(stream);
    // Sin tarea, task_not_found gana: lo da decide más abajo.
    if (view.exists && opts.ifMatch !== undefined && opts.ifMatch !== version) {
      return { kind: "precondition_failed", current: version };
    }
    const at = clock().toISOString();
    // Sin tarea no se guardan blobs: decide devuelve task_not_found.
    const blob = (text: string) =>
      view.exists ? textBlob(text, cmd.number) : Promise.resolve(null);
    let command: TaskCommand;
    if (cmd.type === "edit") {
      const changes: Extract<TaskCommand, { type: "edit" }>["changes"] = {};
      if (cmd.title !== undefined && view.exists)
        changes.title = await putText(cmd.title, cmd.number);
      if (cmd.description !== undefined) changes.description = await blob(cmd.description);
      if (cmd.acceptanceCriteria !== undefined) {
        changes.acceptanceCriteria = await blob(cmd.acceptanceCriteria);
      }
      command = { type: "edit", actor, at, changes };
    } else if (cmd.type === "submit") {
      command = { type: "submit", actor, at };
    } else {
      // Texto vacío => null: decide lo rechaza con su invalid_reason (y su precedencia).
      const text = await blob(cmd.text);
      command = { type: "reject", actor, at, reason: { category: cmd.category, text } };
    }
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
