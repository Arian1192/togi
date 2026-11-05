import {
  AGENT_EVENT_KINDS,
  type AgentEventKind,
  type BlobStore,
  type ChainVerdict,
  GENESIS_HASH,
  hashAgentEvent,
  type StoredAgentEvent,
  type TaskId,
  verifyAgentChain,
} from "@togi/core";
import type Database from "better-sqlite3";

export type AgentVerdict = ChainVerdict | { ok: false; brokenAt: number; session: string };

interface Row {
  session_id: string;
  seq: number;
  at: string;
  kind: AgentEventKind;
  payload: string;
  prev_hash: string;
  hash: string;
}

const toEvent = (r: Row): StoredAgentEvent => ({
  sessionId: r.session_id,
  seq: r.seq,
  at: r.at,
  kind: r.kind,
  payload: r.payload,
  prevHash: r.prev_hash,
  hash: r.hash,
});

/**
 * Trayectoria del agente (ADR-004): `agent_events`, append-only, con una cadena de hashes por
 * sesión. El contenido va a un blob `trajectory`, que ya limpia los secretos; la fila solo guarda
 * su `BlobRef`.
 */
export class AgentEventStore {
  readonly #db: Database.Database;
  readonly #blobs: BlobStore;
  readonly #clock: () => Date;

  constructor(db: Database.Database, blobs: BlobStore, clock: () => Date = () => new Date()) {
    this.#db = db;
    this.#blobs = blobs;
    this.#clock = clock;
  }

  async append(
    sessionId: string,
    taskId: TaskId,
    kind: AgentEventKind,
    payload: unknown,
  ): Promise<StoredAgentEvent> {
    if (!AGENT_EVENT_KINDS.includes(kind))
      throw new RangeError(`tipo de evento desconocido: ${kind}`);
    // El blob se escribe antes de la transacción: la cadena no espera a la E/S de ficheros.
    const ref = await this.#blobs.put(
      new TextEncoder().encode(JSON.stringify(payload) ?? "null"),
      "trajectory",
      taskId,
    );
    const at = this.#clock().toISOString();
    return this.#db
      .transaction((): StoredAgentEvent => {
        const last = this.#db
          .prepare(
            "SELECT seq, hash FROM agent_events WHERE session_id = ? ORDER BY seq DESC LIMIT 1",
          )
          .get(sessionId) as { seq: number; hash: string } | undefined;
        const prevHash = last?.hash ?? GENESIS_HASH;
        const event = {
          sessionId,
          seq: (last?.seq ?? 0) + 1,
          at,
          kind,
          payload: JSON.stringify(ref),
        };
        const hash = hashAgentEvent(prevHash, event);
        this.#db
          .prepare("INSERT INTO agent_events VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(sessionId, event.seq, at, kind, event.payload, prevHash, hash);
        return { ...event, prevHash, hash };
      })
      .immediate();
  }

  readSession(sessionId: string): StoredAgentEvent[] {
    const rows = this.#db
      .prepare("SELECT * FROM agent_events WHERE session_id = ? ORDER BY seq")
      .all(sessionId) as Row[];
    return rows.map(toEvent);
  }

  /**
   * Recorre la cadena de cada sesión y la cruza con el log de dominio: una sesión con
   * `session.ended` debe tener exactamente `trajectoryEvents` eventos. Así se detectan un final
   * truncado y una sesión borrada entera. `brokenAt` es el primer evento que falta o sobra.
   */
  verify(): AgentVerdict {
    const sessions = this.#db
      .prepare("SELECT DISTINCT session_id FROM agent_events ORDER BY session_id")
      .all() as { session_id: string }[];
    for (const { session_id } of sessions) {
      const verdict = verifyAgentChain(this.readSession(session_id));
      if (!verdict.ok) return { ...verdict, session: session_id };
    }
    const ended = this.#db
      .prepare(
        `SELECT json_extract(payload, '$.sessionId') AS session,
                json_extract(payload, '$.trajectoryEvents') AS expected
         FROM events WHERE type = 'session.ended' ORDER BY seq`,
      )
      .all() as { session: string; expected: number }[];
    const count = this.#db.prepare("SELECT COUNT(*) AS n FROM agent_events WHERE session_id = ?");
    for (const { session, expected } of ended) {
      const actual = (count.get(session) as { n: number }).n;
      if (actual !== expected)
        return { ok: false, brokenAt: Math.min(actual, expected) + 1, session };
    }
    return { ok: true };
  }
}
