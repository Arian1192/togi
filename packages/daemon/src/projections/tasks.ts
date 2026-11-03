import {
  type DomainEvent,
  evolve,
  type RiskLevel,
  type TaskState,
  toDomainEvent,
} from "@togi/core";
import type Database from "better-sqlite3";
import type { SqliteEventStore } from "../store/event-store.ts";

/**
 * Proyección `tasks`: SOLO para consultas (listados, API de lectura). Las decisiones del flujo
 * nunca se toman desde esta tabla: se reconstruye el `TaskView` desde el stream de la tarea con
 * `evolve` y se decide sobre eso. La tabla puede ir por detrás del log; el log manda.
 */

interface TaskRow {
  title: string;
  state: TaskState;
  risk: RiskLevel;
}

const TASK_STREAM = /^task:(\d+)$/;

/** Aplica un evento a la tabla. Síncrono: se llama dentro de la transacción del append. */
export function applyToTasks(db: Database.Database, event: DomainEvent): void {
  if (event.type === "data.erased") return; // admin: no cambia nada
  const match = TASK_STREAM.exec(event.stream);
  if (match === null)
    throw new Error(`${event.type} en un stream que no es de tarea: ${event.stream}`);
  const number = Number(match[1]);

  if (event.type === "task.created") {
    const { title, risk, repo, baseBranch } = event.payload;
    db.prepare(
      `INSERT INTO tasks (number, title, state, risk, repo, base_branch, stream_version, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    ).run(number, title, risk, repo, baseBranch, event.streamVersion, event.at, event.at);
    return;
  }

  const row = db.prepare("SELECT title, state, risk FROM tasks WHERE number = ?").get(number) as
    | TaskRow
    | undefined;
  if (row === undefined) throw new Error(`evento ${event.type} sobre la tarea ${number} sin fila`);
  // La tabla no guarda description ni acceptanceCriteria: evolve solo los sobrescribe, no los lee.
  const view = evolve({ exists: true, ...row, description: null, acceptanceCriteria: null }, event);
  if (!view.exists) return;
  db.prepare(
    "UPDATE tasks SET title = ?, state = ?, risk = ?, stream_version = ?, updated_at = ? WHERE number = ?",
  ).run(view.title, view.state, view.risk, event.streamVersion, event.at, number);
}

/**
 * Vacía `tasks` y la reconstruye desde el log, en una sola transacción síncrona: toma el lock de
 * escritura antes de leer, así que ningún append se cuela entre la lectura y el commit. Lee por
 * lotes, con memoria constante.
 */
export function rebuildTasks(
  db: Database.Database,
  store: SqliteEventStore,
  batchSize = 500,
): void {
  db.transaction(() => {
    db.exec("DELETE FROM tasks");
    for (let next = 1; ; ) {
      const batch = store.readBatchSync(next, batchSize);
      for (const stored of batch) applyToTasks(db, toDomainEvent(stored));
      const last = batch.at(-1);
      if (last === undefined || batch.length < batchSize) return;
      next = last.seq + 1;
    }
  }).immediate();
}
