import {
  type ChainVerdict,
  type EventEnvelope,
  type EventStore,
  GENESIS_HASH,
  hashEvent,
  type NewEvent,
  type StoredEvent,
  VersionConflictError,
} from "@togi/core";
import type Database from "better-sqlite3";

export class SqliteEventStore implements EventStore {
  readonly #db: Database.Database;
  readonly #version: Database.Statement;
  readonly #last: Database.Statement;
  readonly #insert: Database.Statement;

  constructor(db: Database.Database) {
    this.#db = db;
    this.#version = db.prepare("SELECT MAX(stream_version) AS v FROM events WHERE stream = ?");
    this.#last = db.prepare("SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1");
    this.#insert = db.prepare(
      "INSERT INTO events (seq, stream, stream_version, type, schema_version, actor, at, correlation_id, payload, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
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
    return this.#db
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
  }

  async append(
    stream: string,
    expectedVersion: number,
    events: NewEvent[],
  ): Promise<StoredEvent[]> {
    return this.appendWithin(stream, expectedVersion, events, () => {});
  }

  readStream(_stream: string, _fromVersion?: number): AsyncIterable<StoredEvent> {
    throw new Error("not implemented: llega en 5b-2");
  }

  readAll(_fromSeq?: number): AsyncIterable<StoredEvent> {
    throw new Error("not implemented: llega en 5b-2");
  }

  verify(): Promise<ChainVerdict> {
    throw new Error("not implemented: llega en 5b-2");
  }
}
