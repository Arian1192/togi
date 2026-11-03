import { EventParseError, type StoredEvent, toDomainEvent } from "@togi/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "./app.ts";
import { problem } from "./problem.ts";
import type { ReadDeps } from "./queries.ts";

const LAST_EVENT_ID = /^\d+$/;
const DEFAULT_HEARTBEAT_MS = 15_000;

/**
 * SSE del log global (ADR-005). Primero se suscribe y guarda lo que llegue; después recorre el
 * historial; al terminar vacía la cola descartando lo ya enviado y sigue en directo. La cola de un
 * cliente lento no tiene tope: límite conocido.
 */
export function eventRoutes(reads: ReadDeps | undefined) {
  return new Hono<AppEnv>().get("/v1/events", (c) => {
    if (reads === undefined) return problem(503, "not_configured", "consultas no disponibles");
    const header = c.req.header("last-event-id");
    if (header !== undefined && !LAST_EVENT_ID.test(header)) {
      return problem(400, "validation_error", "Last-Event-ID debe ser un entero >= 0");
    }
    const from = header === undefined ? 0 : Number(header);
    const { store, heartbeatMs = DEFAULT_HEARTBEAT_MS } = reads;

    return streamSSE(c, async (stream) => {
      const queue: StoredEvent[] = [];
      let wake: (() => void) | undefined;
      let closed = false;
      const close = () => {
        closed = true;
        wake?.();
      };
      const unsubscribe = store.subscribe((event) => {
        queue.push(event);
        wake?.();
      });
      const timer = setInterval(() => {
        stream.write(": ping\n\n").catch(close);
      }, heartbeatMs);
      stream.onAbort(close);

      let last = from;
      // false si el evento es corrupto: se avisa y el stream termina.
      const send = async (stored: StoredEvent): Promise<boolean> => {
        if (stored.seq <= last) return true;
        try {
          const event = toDomainEvent(stored);
          await stream.writeSSE({
            id: String(stored.seq),
            event: stored.type,
            data: JSON.stringify(event),
          });
        } catch (e) {
          if (!(e instanceof EventParseError)) throw e;
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ code: "integrity_error", seq: stored.seq }),
          });
          return false;
        }
        last = stored.seq;
        return true;
      };

      try {
        for await (const stored of store.readAll(from + 1)) {
          if (closed || !(await send(stored))) return;
        }
        while (!closed) {
          const next = queue.shift();
          if (next === undefined) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
          } else if (!(await send(next))) return;
        }
      } finally {
        unsubscribe();
        clearInterval(timer);
      }
    });
  });
}
