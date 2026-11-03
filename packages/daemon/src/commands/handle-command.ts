import {
  type Actor,
  type BlobRef,
  type BlobStore,
  decide as coreDecide,
  type DomainError,
  type FlowPolicy,
  type NewTaskEvent,
  NO_TASK,
  type RiskLevel,
  type StoredEvent,
  type TaskSource,
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

  return async function handleCommand(actor: Actor, cmd: CreateTaskInput): Promise<HandleResult> {
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
}
