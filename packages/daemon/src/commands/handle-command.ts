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
import { applyToTasks } from "../projections/tasks.ts";
import type { SqliteEventStore } from "../store/event-store.ts";

const POLICY: FlowPolicy = { maxLines: 300, maxFailedCycles: 3 };

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

export type HandleResult = { number: number; events: StoredEvent[] } | DomainError;

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

  const textBlob = async (text: string, taskId: number): Promise<BlobRef | null> =>
    text.trim() === "" ? null : blobs.put(new TextEncoder().encode(text), "task_text", taskId);

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

  const create = async (actor: Actor, cmd: CreateTaskInput): Promise<HandleResult> => {
    // 1. Reserva en su propia transacción: si algo falla después, el número queda gastado.
    const at = clock().toISOString();
    const number = Number(reserve.run(at).lastInsertRowid);
    // 2. Blobs con el taskId reservado.
    const description = await textBlob(cmd.description, number);
    const acceptanceCriteria = await textBlob(cmd.acceptanceCriteria, number);
    // 3-4. Una tarea nueva se decide sobre la vista de una tarea inexistente.
    const { type: _type, ...fields } = cmd;
    const decided = decide(
      NO_TASK,
      { ...fields, type: "create", description, acceptanceCriteria, actor, at },
      POLICY,
    );
    if (!Array.isArray(decided)) return decided;
    // 5. Log y proyección en la misma transacción; un VersionConflictError se propaga.
    const events = store.appendWithin(
      `task:${number}`,
      0,
      decided as NewTaskEvent[],
      (stored, tx) => {
        for (const event of stored) applyToTasks(tx, toDomainEvent(event));
      },
    );
    return { number, events };
  };

  const modify = async (
    actor: Actor,
    cmd: EditTaskInput | SubmitTaskInput | RejectTaskInput,
  ): Promise<HandleResult> => {
    const stream = `task:${cmd.number}`;
    const { view, version } = await loadView(stream);
    const at = clock().toISOString();
    // Sin tarea no se guardan blobs: decide devuelve task_not_found.
    const blob = (text: string) =>
      view.exists ? textBlob(text, cmd.number) : Promise.resolve(null);
    let command: TaskCommand;
    if (cmd.type === "edit") {
      const changes: Extract<TaskCommand, { type: "edit" }>["changes"] = {};
      if (cmd.title !== undefined) changes.title = cmd.title;
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
    const events = store.appendWithin(stream, version, decided as NewTaskEvent[], (stored, tx) => {
      for (const event of stored) applyToTasks(tx, toDomainEvent(event));
    });
    return { number: cmd.number, events };
  };

  return function handleCommand(actor: Actor, cmd: CommandInput): Promise<HandleResult> {
    return cmd.type === "create" ? create(actor, cmd) : modify(actor, cmd);
  };
}
