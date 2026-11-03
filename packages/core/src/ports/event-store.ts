import type { EventEnvelope } from "../model/events.ts";

export type NewEvent = Omit<EventEnvelope<string, unknown>, "seq" | "stream" | "streamVersion">;

export type StoredEvent = EventEnvelope<string, unknown> & { prevHash: string; hash: string };

/** Lo lanza `append` cuando la versión esperada no coincide con la del stream; no escribe nada. */
export class VersionConflictError extends Error {
  readonly stream: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(stream: string, expectedVersion: number, actualVersion: number) {
    super(
      `conflicto de versión en ${stream}: esperada ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = "VersionConflictError";
    this.stream = stream;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export interface EventStore {
  /**
   * Un stream inexistente tiene versión 0: `append(stream, 0, …)` lo crea. Lanza
   * `VersionConflictError` si `expectedVersion` no es la versión actual, y `RangeError` si `events`
   * está vacío. Las dos cosas ocurren sin escribir nada.
   */
  append(stream: string, expectedVersion: number, events: NewEvent[]): Promise<StoredEvent[]>;
  readStream(stream: string, fromVersion?: number): AsyncIterable<StoredEvent>;
  readAll(fromSeq?: number): AsyncIterable<StoredEvent>;
  verify(): Promise<{ ok: true } | { ok: false; brokenAt: number }>;
}
