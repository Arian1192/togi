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
  onOpen?: () => void,
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
    onOpen?.();
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
    // Un corte a mitad del cuerpo llega como error de red, no como CliError.
    throw error instanceof CliError ? error : daemonUnavailable();
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

/** Esperas de la reconexión, en ms: la primera, el tope y cuánto sin conectar antes de rendirse. */
export interface Backoff {
  initialMs: number;
  maxMs: number;
  giveUpMs: number;
}

export const DEFAULT_BACKOFF: Backoff = { initialMs: 250, maxMs: 5_000, giveUpMs: 30_000 };

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/**
 * Como `eventStream`, pero si la conexión se corta reconecta con `Last-Event-ID` = el último `seq`
 * entregado, con espera creciente (se duplica hasta `maxMs`) y descartando los `seq` ya vistos. Si
 * pasan `giveUpMs` sin lograr conectar, lanza «daemon no disponible» (6). Otros errores no se
 * reintentan.
 */
export async function* reconnectingStream(
  client: Client,
  after: number | undefined,
  signal: AbortSignal,
  backoff: Backoff = DEFAULT_BACKOFF,
): AsyncGenerator<WatchedEvent> {
  let last = after;
  let delay = backoff.initialMs;
  let since = Date.now();
  while (!signal.aborted) {
    let openedAt: number | undefined;
    let delivered = false;
    try {
      for await (const event of eventStream(client, last, signal, () => {
        openedAt = Date.now();
      })) {
        if (last !== undefined && event.seq <= last) continue;
        last = event.seq;
        delivered = true;
        yield event;
      }
      return;
    } catch (error) {
      if (!(error instanceof CliError) || error.exitCode !== 6) throw error;
    }
    // Una conexión que sirvió algo o aguantó un rato cuenta como lograda; una que cae al instante, no.
    if (openedAt !== undefined && (delivered || Date.now() - openedAt >= backoff.maxMs)) {
      delay = backoff.initialMs;
      since = Date.now();
    }
    if (Date.now() - since >= backoff.giveUpMs) throw daemonUnavailable();
    await sleep(delay, signal);
    delay = Math.min(delay * 2, backoff.maxMs);
  }
}
