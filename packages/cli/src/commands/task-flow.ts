import { REASON_CATEGORIES } from "@togi/core";
import { type Client, createClient } from "../client.ts";
import { usageError } from "../errors.ts";
import { clean, say } from "../format.ts";
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

interface Read {
  etag: string;
  title: string | null;
}

/** Lee el detalle de la tarea: su `ETag`, tal cual, para `If-Match`, y el título para nombrarla. */
async function readTask(client: Client, n: string): Promise<Read> {
  const { body, headers } = await client.checkedWithHeaders<{ title: string | null }>(
    await client.api.v1.tasks[":n"].$get({ param: { n } }),
    { n: Number(n) },
  );
  const etag = headers.get("etag");
  if (etag === null) throw new Error("el daemon no devolvió ETag");
  return { etag, title: body.title };
}

/** Envía la tarea a planning. Ante un 412 no reintenta: el error sale con código 4. */
export async function submitTask(home: string, n: string, hooks: FlowHooks = {}) {
  const client = createClient(home);
  const { etag } = await readTask(client, n);
  await hooks.afterRead?.();
  return client.checked<{ number: number; state: string }>(
    await client.api.v1.tasks[":n"].submit.$post(
      { param: { n } },
      { headers: { "if-match": etag } },
    ),
    { n: Number(n) },
  );
}

export interface RejectInput {
  category: string;
  text: string;
  /** `undefined` con `--yes`; si no, pregunta y devuelve si la persona confirma. */
  confirm?: (question: string) => Promise<boolean>;
}

/** Rechaza la tarea. `null` si la persona cancela en la confirmación. */
export async function rejectTask(
  home: string,
  n: string,
  input: RejectInput,
  hooks: FlowHooks = {},
) {
  const client = createClient(home);
  const { etag, title } = await readTask(client, n);
  if (input.confirm !== undefined) {
    const name = title === null ? say("text_erased") : clean(title);
    const question = say("reject_confirm", { n: Number(n), title: name });
    if (!(await input.confirm(question))) return null;
  }
  await hooks.afterRead?.();
  return client.checked<{ number: number; state: string }>(
    await client.api.v1.tasks[":n"].reject.$post(
      { param: { n } },
      {
        headers: { "if-match": etag, "content-type": "application/json" },
        init: { body: JSON.stringify({ reason: { category: input.category, text: input.text } }) },
      },
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

const reject: Command = {
  summary: "Rechaza una tarea (definitivo).",
  example: 'togi task reject 12 --category scope --reason "Duplica la #9"',
  options: {
    category: { type: "string" },
    reason: { type: "string" },
    yes: { type: "boolean", short: "y" },
  },
  usage: `Uso: togi task reject <número> --category <categoría> --reason <texto> [--yes]

Rechaza una tarea. Es definitivo: la tarea queda cerrada.

Categorías: ${REASON_CATEGORIES.join(", ")}

Ejemplo:
  togi task reject 12 --category scope --reason "Duplica la #9"
`,
  async run({ home, json, out, values, args, interactive, confirm }) {
    const command = "togi task reject --help";
    const n = taskNumber(args, command);
    const category = values.category;
    const reason = values.reason;
    if (typeof category !== "string")
      throw usageError("missing_option", { field: "--category", command });
    if (typeof reason !== "string")
      throw usageError("missing_option", { field: "--reason", command });
    if (!(REASON_CATEGORIES as readonly string[]).includes(category)) {
      throw usageError("invalid_option", {
        field: "--category",
        detail: REASON_CATEGORIES.join(", "),
        command,
      });
    }
    const text = reason.trim();
    if (text === "") {
      throw usageError("invalid_option", {
        field: "--reason",
        detail: "no puede estar vacío",
        command,
      });
    }
    const yes = values.yes === true;
    if (!yes && !interactive) throw usageError("confirmation_required", { n: Number(n), command });
    const done = await rejectTask(home, n, { category, text, ...(yes ? {} : { confirm }) });
    if (done === null) return `${say("reject_cancelled")}\n`;
    if (json) return `${JSON.stringify(done)}\n`;
    return `${out.mark("ok", say("task_rejected", { n: done.number }))}\n`;
  },
};

export const flow = { submit, reject };
