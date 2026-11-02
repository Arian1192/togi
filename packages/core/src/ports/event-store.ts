import type { EventEnvelope } from "../model/events.ts";

export type NewEvent = Omit<EventEnvelope<string, unknown>, "seq" | "stream" | "streamVersion">;

export type StoredEvent = EventEnvelope<string, unknown> & { prevHash: string; hash: string };

export interface EventStore {
  append(stream: string, expectedVersion: number, events: NewEvent[]): Promise<StoredEvent[]>;
  readStream(stream: string, fromVersion?: number): AsyncIterable<StoredEvent>;
  readAll(fromSeq?: number): AsyncIterable<StoredEvent>;
  verify(): Promise<{ ok: true } | { ok: false; brokenAt: number }>;
}
