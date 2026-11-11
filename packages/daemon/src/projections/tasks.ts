import {
  type BlobRef,
  type DomainEvent,
  EventParseError,
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
  /** BlobRef del título serializada en JSON; el texto solo existe cifrado. */
  title: string;
  state: TaskState;
  risk: RiskLevel;
  has_criteria: number;
}

const TASK_STREAM = /^task:(\d+)$/;

/** Aplica un evento a la tabla. Síncrono: se llama dentro de la transacción del append. */
export function applyToTasks(db: Database.Database, event: DomainEvent): void {
  if (event.type === "data.erased") return; // admin: no cambia nada
  if (event.type === "specialist.version_published") return; // catálogo: no es una tarea
  if (event.type === "repo.profile_set") return; // perfil del repo: no es una tarea
  const match = TASK_STREAM.exec(event.stream);
  if (match === null)
    throw new Error(`${event.type} en un stream que no es de tarea: ${event.stream}`);
  const number = Number(match[1]);

  if (event.type === "task.created") {
    const { title, risk, repo, baseBranch, acceptanceCriteria } = event.payload;
    db.prepare(
      `INSERT INTO tasks (number, title, state, risk, repo, base_branch, has_criteria, stream_version, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      number,
      JSON.stringify(title),
      risk,
      repo,
      baseBranch,
      acceptanceCriteria === null ? 0 : 1,
      event.streamVersion,
      event.at,
      event.at,
    );
    return;
  }

  const row = db
    .prepare("SELECT title, state, risk, has_criteria FROM tasks WHERE number = ?")
    .get(number) as TaskRow | undefined;
  if (row === undefined) throw new Error(`evento ${event.type} sobre la tarea ${number} sin fila`);
  // La tabla no guarda description ni acceptanceCriteria: evolve solo los sobrescribe, no los lee.
  const title = JSON.parse(row.title) as BlobRef;
  const { has_criteria: hasCriteria, ...fields } = row;
  const view = evolve(
    { exists: true, ...fields, title, description: null, acceptanceCriteria: null },
    event,
  );
  if (!view.exists) return;
  db.prepare(
    "UPDATE tasks SET title = ?, state = ?, risk = ?, has_criteria = ?, stream_version = ?, updated_at = ? WHERE number = ?",
  ).run(
    JSON.stringify(view.title),
    view.state,
    view.risk,
    // Una edición sin `acceptanceCriteria` no cambia el indicador; con él, `null` lo apaga.
    event.type === "task.edited" && event.payload.acceptanceCriteria !== undefined
      ? Number(event.payload.acceptanceCriteria !== null)
      : hasCriteria,
    event.streamVersion,
    event.at,
    number,
  );
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
      for (const stored of batch) {
        try {
          applyToTasks(db, toDomainEvent(stored));
        } catch (error) {
          // El arranque muestra este mensaje en el log: debe decir qué evento y por qué.
          const reason = error instanceof Error ? error.message : String(error);
          const where = error instanceof EventParseError ? "" : `evento seq ${stored.seq}: `;
          throw new Error(`no se pudo reconstruir la proyección tasks: ${where}${reason}`, {
            cause: error,
          });
        }
      }
      const last = batch.at(-1);
      if (last === undefined || batch.length < batchSize) return;
      next = last.seq + 1;
    }
  }).immediate();
}
