import { type DomainEvent, EventParseError, toDomainEvent } from "@togi/core";
import type Database from "better-sqlite3";
import type { SqliteEventStore } from "../store/event-store.ts";
import { applyToPlanning } from "./planning.ts";
import { applyToTasks } from "./tasks.ts";

/** Todas las proyecciones, en la misma transacción que el append. */
export function applyProjections(db: Database.Database, event: DomainEvent): void {
  applyToTasks(db, event);
  applyToPlanning(db, event);
}

/**
 * Vacía todas las proyecciones y las reconstruye desde el log en una transacción síncrona (toma el
 * lock de escritura antes de leer). Lee por lotes, con memoria constante.
 */
export function rebuildProjections(
  db: Database.Database,
  store: SqliteEventStore,
  batchSize = 500,
): void {
  db.transaction(() => {
    for (const table of ["tasks", "plans", "sessions", "decisions"])
      db.exec(`DELETE FROM ${table}`);
    for (let next = 1; ; ) {
      const batch = store.readBatchSync(next, batchSize);
      for (const stored of batch) {
        // El arranque muestra este mensaje en el log: debe decir qué proyección, qué evento y por qué.
        const step = (name: string, run: () => void) => {
          try {
            run();
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const where = error instanceof EventParseError ? "" : `evento seq ${stored.seq}: `;
            throw new Error(`no se pudo reconstruir la proyección ${name}: ${where}${reason}`, {
              cause: error,
            });
          }
        };
        let event: DomainEvent | undefined;
        step("tasks", () => {
          event = toDomainEvent(stored);
          applyToTasks(db, event);
        });
        step("planning", () => applyToPlanning(db, event as DomainEvent));
      }
      const last = batch.at(-1);
      if (last === undefined || batch.length < batchSize) return;
      next = last.seq + 1;
    }
  }).immediate();
}
