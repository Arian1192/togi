import type { Client } from "./client.ts";
import { CliError, daemonUnavailable } from "./errors.ts";
import { parseSse } from "./sse.ts";

/** Un evento ya validado en su forma; el resto del `DomainEvent` viaja tal cual. */
export interface WatchedEvent {
  seq: number;
  stream: string;
  type: string;
  at: string;
  actor: Record<string, unknown>;
}

function parseEvent(data: string): WatchedEvent | undefined {
  try {
    const e = JSON.parse(data) as Partial<WatchedEvent> | null;
    const ok =
      e !== null &&
      typeof e === "object" &&
      Number.isInteger(e.seq) &&
      typeof e.stream === "string" &&
      typeof e.type === "string" &&
      typeof e.at === "string" &&
      typeof e.actor === "object" &&
      e.actor !== null;
    return ok ? (e as WatchedEvent) : undefined;
  } catch {
    return undefined;
  }
}

/** El `seq` del último evento del log (`/v1/health`); desde ahí empiezan los eventos nuevos. */
export async function lastSeq(client: Client): Promise<number> {
  const health = await client.checked<{ lastSeq: number }>(await client.api.v1.health.$get());
  return health.lastSeq;
}

/**
 * Abre `GET /v1/events` y entrega los eventos según llegan. `after` es el `Last-Event-ID`; sin él,
 * el daemon reproduce todo el historial. Termina sin error solo si se aborta; si la conexión se
 * corta, lanza «daemon no disponible» (6); un `event: error` es un fallo de integridad (1).
 */
export async function* eventStream(
  client: Client,
  after: number | undefined,
  signal: AbortSignal,
): AsyncGenerator<WatchedEvent> {
  try {
    const res = await client.api.v1.events.$get(
      undefined,
      after === undefined
        ? { init: { signal } }
        : { headers: { "last-event-id": String(after) }, init: { signal } },
    );
    if (!res.ok) await client.checked(res);
    if (res.body === null) throw daemonUnavailable();
    for await (const message of parseSse(res.body)) {
      const seq = Number(message.id);
      const context = { requestId: client.requestId, ...(Number.isInteger(seq) && { event: seq }) };
      if (message.event === "error") {
        const body = parseJson(message.data) as { seq?: unknown } | undefined;
        const bad = Number.isInteger(body?.seq) ? { event: body?.seq as number } : {};
        throw new CliError("integrity_error", 1, { requestId: client.requestId, ...bad });
      }
      const event = parseEvent(message.data);
      if (event === undefined) throw new CliError("integrity_error", 1, context);
      yield event;
    }
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
  if (!signal.aborted) throw daemonUnavailable();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
