import {
  type ChainVerdict,
  type EventEnvelope,
  type EventStore,
  GENESIS_HASH,
  hashEvent,
  type NewEvent,
  type StoredEvent,
  VersionConflictError,
  verifyChain,
} from "@togi/core";
import type Database from "better-sqlite3";

const BATCH_SIZE = 500;

interface Row {
  seq: number;
  stream: string;
  stream_version: number;
  type: string;
  schema_version: number;
  actor: string;
  at: string;
  correlation_id: string | null;
  payload: string;
  prev_hash: string;
  hash: string;
}

/** correlation_id NULL se vuelve campo ausente: hashEvent rechaza null (PR 4). */
const toEvent = (row: Row): StoredEvent => ({
  seq: row.seq,
  stream: row.stream,
  streamVersion: row.stream_version,
  type: row.type,
  schemaVersion: row.schema_version,
  actor: JSON.parse(row.actor),
  at: row.at,
  ...(row.correlation_id === null ? {} : { correlationId: row.correlation_id }),
  payload: JSON.parse(row.payload),
  prevHash: row.prev_hash,
  hash: row.hash,
});

/** Lee por lotes, sin cursor abierto: el consumidor puede escribir mientras itera. */
async function* paged(
  statement: Database.Statement,
  args: unknown[],
  from: number,
  key: "seq" | "stream_version",
): AsyncGenerator<StoredEvent> {
  for (let next = from; ; ) {
    const rows = statement.all(...args, next, BATCH_SIZE) as Row[];
    yield* rows.map(toEvent);
    const last = rows.at(-1);
    if (last === undefined || rows.length < BATCH_SIZE) return;
    next = last[key] + 1;
  }
}

export type EventListener = (event: StoredEvent) => void;

export class SqliteEventStore implements EventStore {
  readonly #db: Database.Database;
  readonly #listeners = new Set<EventListener>();
  readonly #version: Database.Statement;
  readonly #last: Database.Statement;
  readonly #insert: Database.Statement;
  readonly #allFrom: Database.Statement;
  readonly #streamFrom: Database.Statement;

  constructor(db: Database.Database) {
    this.#db = db;
    this.#version = db.prepare("SELECT MAX(stream_version) AS v FROM events WHERE stream = ?");
    this.#last = db.prepare("SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1");
    this.#insert = db.prepare(
      "INSERT INTO events (seq, stream, stream_version, type, schema_version, actor, at, correlation_id, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.#allFrom = db.prepare("SELECT * FROM events WHERE seq >= ? ORDER BY seq LIMIT ?");
    this.#streamFrom = db.prepare(
      "SELECT * FROM events WHERE stream = ? AND stream_version >= ? ORDER BY stream_version LIMIT ?",
    );
  }

  /** Versión actual del stream (0 si no existe). Síncrona, para usarla con `appendWithin`. */
  currentVersion(stream: string): number {
    return (this.#version.get(stream) as { v: number | null }).v ?? 0;
  }

  /**
   * Avisa de cada evento nuevo, solo después de que su transacción se confirme. Un listener que
   * lanza se registra y no afecta a quien escribe ni al resto. Devuelve la función para darse de baja.
   */
  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  subscriberCount(): number {
    return this.#listeners.size;
  }

  #notify(events: StoredEvent[]): void {
    for (const event of events) {
      for (const listener of [...this.#listeners]) {
        try {
          listener(event);
        } catch (error) {
          console.error(`listener de eventos falló en seq ${event.seq}:`, error);
        }
      }
    }
  }

  /**
   * Como `append`, pero ejecuta `within` en la misma transacción: si lanza, se revierte todo, el
   * evento incluido. Es síncrono porque better-sqlite3 no admite esperas dentro de una transacción.
   */
  appendWithin(
    stream: string,
    expectedVersion: number,
    events: NewEvent[],
    within: (stored: StoredEvent[], db: Database.Database) => void,
  ): StoredEvent[] {
    if (events.length === 0) throw new RangeError("append: la lista de eventos está vacía");
    // Dentro de otra transacción no hay commit propio: avisar ahora sería avisar de algo revocable.
    if (this.#db.inTransaction) {
      throw new Error("appendWithin no puede ejecutarse dentro de otra transacción");
    }
    const stored = this.#db
      .transaction((): StoredEvent[] => {
        const actual = (this.#version.get(stream) as { v: number | null }).v ?? 0;
        if (actual !== expectedVersion) {
          throw new VersionConflictError(stream, expectedVersion, actual);
        }
        const last = this.#last.get() as { seq: number; hash: string } | undefined;
        let { seq, hash: prevHash } = last ?? { seq: 0, hash: GENESIS_HASH };
        const stored = events.map((event, index): StoredEvent => {
          seq += 1;
          // Se hashea el evento tal como se leerá, tras el viaje por JSON (descarta undefined).
          const envelope: EventEnvelope<string, unknown> = JSON.parse(
            JSON.stringify({ ...event, seq, stream, streamVersion: actual + index + 1 }),
          );
          const hash = hashEvent(prevHash, envelope);
          this.#insert.run(
            seq,
            stream,
            envelope.streamVersion,
            envelope.type,
            envelope.schemaVersion,
            JSON.stringify(envelope.actor),
            envelope.at,
            envelope.correlationId ?? null,
            JSON.stringify(envelope.payload),
            prevHash,
            hash,
          );
          const result = { ...envelope, prevHash, hash };
          prevHash = hash;
          return result;
        });
        within(stored, this.#db);
        return stored;
      })
      .immediate();
    this.#notify(stored);
    return stored;
  }

  async append(
    stream: string,
    expectedVersion: number,
    events: NewEvent[],
  ): Promise<StoredEvent[]> {
    return this.appendWithin(stream, expectedVersion, events, () => {});
  }

  /** Lectura síncrona de un lote, para usarla dentro de una transacción. Interna del daemon. */
  readBatchSync(fromSeq: number, limit: number): StoredEvent[] {
    return (this.#allFrom.all(fromSeq, limit) as Row[]).map(toEvent);
  }

  readStream(stream: string, fromVersion = 1): AsyncIterable<StoredEvent> {
    return paged(this.#streamFrom, [stream], fromVersion, "stream_version");
  }

  readAll(fromSeq = 1): AsyncIterable<StoredEvent> {
    return paged(this.#allFrom, [], fromSeq, "seq");
  }

  verify(): Promise<ChainVerdict> {
    return verifyChain(this.readAll());
  }
}
