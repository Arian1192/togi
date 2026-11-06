import { createClient } from "../client.ts";
import { say } from "../format.ts";
import type { Command } from "./index.ts";
import { planNumber } from "./plan-decide.ts";
import { readTask } from "./task-flow.ts";

export const retry: Command = {
  summary: "Lanza otra sesión de planificación para una tarea que quedó en planning.",
  example: "togi plan retry 12",
  usage: `Uso: togi plan retry <número> [--json]

Pide otra sesión del planificador para una tarea que quedó en planning, por ejemplo tras un
fallo. Falla si la tarea no está en planning, si ya hay una sesión en curso o si el daemon no
tiene un planificador activo (mira togi daemon status).

Ejemplo:
  togi plan retry 12
`,
  async run({ home, json, out, args }) {
    const n = planNumber(args, "togi plan retry --help");
    const client = createClient(home);
    // Como submit: la versión leída protege de que la tarea cambie entre la lectura y la petición.
    const { etag } = await readTask(client, n);
    const done = await client.checked<{ number: number; state: string }>(
      await client.api.v1.tasks[":n"].plan.retry.$post(
        { param: { n } },
        { headers: { "if-match": etag } },
      ),
      { n: Number(n) },
    );
    if (json) return `${JSON.stringify(done)}\n`;
    return `${out.mark("ok", say("plan_retry_requested", { n: done.number }))}\n`;
  },
};
