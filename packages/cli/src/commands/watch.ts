import { createClient } from "../client.ts";
import { usageError } from "../errors.ts";
import { eventStream, lastSeq, type WatchedEvent } from "../event-stream.ts";
import type { Command } from "./index.ts";

/** Solo estos caracteres llegan a la terminal desde un campo del evento; el resto es `?`. */
const SAFE = /^[A-Za-z0-9_.:-]+$/;
const safe = (value: unknown): string =>
  typeof value === "string" && SAFE.test(value) ? value : "?";

function actorLabel(actor: Record<string, unknown>): string {
  if (actor.kind === "human") return safe(actor.userId);
  if (actor.kind === "agent") return `${safe(actor.sessionId)} (${safe(actor.role)})`;
  if (actor.kind === "system") return safe(actor.component);
  return "?";
}

const two = (n: number): string => String(n).padStart(2, "0");

/** `HH:MM:SS  #seq  tipo  #tarea  actor`, con la hora local; `—` si el evento no es de una tarea. */
export function formatEvent(e: WatchedEvent): string {
  const d = new Date(e.at);
  const time = Number.isNaN(d.getTime())
    ? "--:--:--"
    : `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  const task = /^task:(\d+)$/.exec(e.stream)?.[1];
  return `${time}  #${e.seq}  ${safe(e.type).padEnd(14)}  ${task === undefined ? "—" : `#${task}`}  ${actorLabel(e.actor)}\n`;
}

export const watch: Command = {
  summary: "Sigue los eventos del log en directo, uno por línea.",
  example: "togi watch --from-start",
  options: { "from-start": { type: "boolean" } },
  usage: `Uso: togi watch [--from-start] [--json]

Muestra los eventos nuevos según se escriben: hora, número de evento, tipo, tarea y actor
(el identificador usr_…). Ctrl+C sale. Con --json escribe un objeto por línea.

  --from-start  Reproduce primero todo el historial.

Si se corta la conexión con el daemon, sale con 6.

Ejemplo:
  togi watch
`,
  async run({ home, json, values, args, write, signal }) {
    if (args.length > 0) {
      throw usageError("invalid_option", {
        field: "un argumento",
        detail: "togi watch no admite ninguno",
        command: "togi watch --help",
      });
    }
    const client = createClient(home);
    const after = values["from-start"] === true ? undefined : await lastSeq(client);
    for await (const event of eventStream(client, after, signal)) {
      write(json ? `${JSON.stringify(event)}\n` : formatEvent(event));
    }
    return "";
  },
};
