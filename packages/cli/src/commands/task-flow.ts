import { type Client, createClient } from "../client.ts";
import { usageError } from "../errors.ts";
import { say } from "../format.ts";
import type { Command } from "./index.ts";

const NUMBER = /^[1-9]\d*$/;

/** Solo para tests: se ejecuta entre la lectura del `ETag` y el envío, para provocar un 412. */
export interface FlowHooks {
  afterRead?: () => Promise<void>;
}

/** Valida el número de tarea de `togi task <verbo> <n>`. */
function taskNumber(args: string[], command: string): string {
  const n = args[0];
  if (n === undefined) throw usageError("missing_option", { field: "el número de tarea", command });
  if (args.length > 1 || !NUMBER.test(n)) {
    throw usageError("invalid_option", { field: "el número de tarea", command });
  }
  return n;
}

/** Lee el detalle de la tarea y devuelve su `ETag`, tal cual, para enviarlo en `If-Match`. */
async function readEtag(client: Client, n: string): Promise<string> {
  const { headers } = await client.checkedWithHeaders<unknown>(
    await client.api.v1.tasks[":n"].$get({ param: { n } }),
    { n: Number(n) },
  );
  const etag = headers.get("etag");
  if (etag === null) throw new Error("el daemon no devolvió ETag");
  return etag;
}

/** Envía la tarea a planning. Ante un 412 no reintenta: el error sale con código 4. */
export async function submitTask(home: string, n: string, hooks: FlowHooks = {}) {
  const client = createClient(home);
  const etag = await readEtag(client, n);
  await hooks.afterRead?.();
  return client.checked<{ number: number; state: string }>(
    await client.api.v1.tasks[":n"].submit.$post(
      { param: { n } },
      { headers: { "if-match": etag } },
    ),
    { n: Number(n) },
  );
}

const submit: Command = {
  summary: "Envía una tarea a planificación.",
  example: "togi task submit 12",
  usage: `Uso: togi task submit <número> [--json]

Envía la tarea a planificación. Necesita criterio de aceptación.

Ejemplo:
  togi task submit 12
`,
  async run({ home, json, out, args }) {
    const n = taskNumber(args, "togi task submit --help");
    const done = await submitTask(home, n);
    if (json) return `${JSON.stringify(done)}\n`;
    return `${out.mark("ok", say("task_submitted", { n: done.number, state: done.state }))}\n`;
  },
};

export const flow = { submit };
