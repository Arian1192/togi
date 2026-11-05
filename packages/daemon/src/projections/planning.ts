import type { Actor, DomainEvent } from "@togi/core";
import type Database from "better-sqlite3";

/**
 * Proyecciones `plans`, `sessions` y `decisions`: SOLO para consultas. Nunca guardan texto de
 * usuario ni del agente (enfoque, motivos): solo sus `BlobRef` en JSON. El actor de una decisión
 * se guarda como su identificador seudónimo, sin nombre ni correo.
 */

const actorId = (actor: Actor): string =>
  actor.kind === "human"
    ? actor.userId
    : actor.kind === "agent"
      ? actor.sessionId
      : actor.component;

/** Aplica un evento a las tres tablas. Síncrono: se llama dentro de la transacción del append. */
export function applyToPlanning(db: Database.Database, event: DomainEvent): void {
  const task = /^task:(\d+)$/.exec(event.stream)?.[1];
  if (task === undefined) return;
  const taskNumber = Number(task);

  switch (event.type) {
    case "plan.proposed": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO plans (task_number, plan_version, session_id, base_sha, files, new_tests, approach,
                            estimated_production, estimated_tests, proposed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        taskNumber,
        p.planVersion,
        p.sessionId,
        p.baseSha,
        JSON.stringify(p.files),
        JSON.stringify(p.newTests),
        JSON.stringify(p.approach),
        p.estimatedLines.production,
        p.estimatedLines.tests,
        event.at,
      );
      return;
    }
    case "session.started": {
      const s = event.payload;
      db.prepare(
        `INSERT INTO sessions (session_id, task_number, role, runtime, model, specialist, state, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      ).run(
        s.sessionId,
        taskNumber,
        s.role,
        `${s.runtime.id}@${s.runtime.version}`,
        s.model,
        `${s.specialist.id}@${s.specialist.version}`,
        event.at,
      );
      return;
    }
    case "session.ended": {
      const s = event.payload;
      const result = db
        .prepare(
          "UPDATE sessions SET state = 'ended', ended_at = ?, outcome = ?, usage = ?, failure_reason = ? WHERE session_id = ?",
        )
        .run(event.at, s.outcome, JSON.stringify(s.usage), s.failureReason, s.sessionId);
      if (result.changes === 0) throw new Error(`session.ended sin sesión ${s.sessionId}`);
      return;
    }
    case "decision.recorded": {
      const d = event.payload;
      db.prepare(
        `INSERT INTO decisions (seq, task_number, gate, verdict, plan_version, actor, reason, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        event.seq,
        taskNumber,
        d.gate,
        d.verdict,
        d.subject.planVersion,
        actorId(event.actor),
        d.verdict === "approve" ? null : JSON.stringify(d.reason),
        event.at,
      );
      return;
    }
    default:
      return;
  }
}
