import { REASON_CATEGORIES } from "@togi/core";
import { type Client, createClient } from "../client.ts";
import { CliError, usageError } from "../errors.ts";
import { clean, say } from "../format.ts";
import type { Command } from "./index.ts";
import { type FlowHooks, readTask } from "./task-flow.ts";

const NUMBER = /^[1-9]\d*$/;

type Verb = "approve" | "request-changes" | "reject";

export interface DecideInput {
  category?: string;
  text?: string;
  /** `undefined` con `--yes` o fuera de `reject`; si no, pregunta y devuelve si la persona confirma. */
  confirm?: (question: string) => Promise<boolean>;
}

/**
 * Decide sobre el plan vigente. El `ETag` es el de `GET /plan`, el plan que se está decidiendo.
 * Un 412 es `plan_changed`: el plan o la tarea cambiaron y hay que releer el plan antes de decidir;
 * la CLI no reintenta nunca. `null` si la persona cancela la confirmación.
 */
export async function decidePlan(
  home: string,
  n: string,
  verb: Verb,
  input: DecideInput = {},
  hooks: FlowHooks = {},
) {
  const client = createClient(home);
  const read = await client.api.v1.tasks[":n"].plan.$get({ param: { n } });
  const { headers } = await client.checkedWithHeaders<unknown>(read, { n: Number(n) });
  const etag = headers.get("etag");
  if (etag === null) throw new Error("el daemon no devolvió ETag");
  if (input.confirm !== undefined) {
    const { title } = await readTask(client, n);
    const name = title === null ? say("text_erased") : clean(title);
    if (!(await input.confirm(say("plan_reject_confirm", { n: Number(n), title: name })))) {
      return null;
    }
  }
  await hooks.afterRead?.();
  return send(client, n, verb, etag, input);
}

async function send(client: Client, n: string, verb: Verb, etag: string, input: DecideInput) {
  const param = { param: { n } };
  const headers = { "if-match": etag, "content-type": "application/json" };
  const init = {
    body: JSON.stringify({ reason: { category: input.category, text: input.text } }),
  };
  const plan = client.api.v1.tasks[":n"].plan;
  const res =
    verb === "approve"
      ? await plan.approve.$post(param, { headers: { "if-match": etag } })
      : verb === "reject"
        ? await plan.reject.$post(param, { headers, init })
        : await plan["request-changes"].$post(param, { headers, init });
  try {
    return await client.checked<{ number: number; state: string }>(res, { n: Number(n) });
  } catch (error) {
    if (error instanceof CliError && error.status === 412) {
      throw new CliError("plan_changed", 4, error.context, 412);
    }
    throw error;
  }
}

function planNumber(args: string[], command: string): string {
  const n = args[0];
  if (n === undefined) throw usageError("missing_option", { field: "el número de tarea", command });
  if (args.length > 1 || !NUMBER.test(n)) {
    throw usageError("invalid_option", { field: "el número de tarea", command });
  }
  return n;
}

/** `--category` y `--reason`, validados como en `task reject`. */
function reasonOf(values: Record<string, string | boolean | undefined>, command: string) {
  const { category, reason } = values;
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
  return { category, text };
}

const REASON_OPTIONS = { category: { type: "string" }, reason: { type: "string" } } as const;

const approve: Command = {
  summary: "Aprueba el plan vigente de una tarea.",
  example: "togi plan approve 12",
  usage: `Uso: togi plan approve <número> [--json]

Aprueba el plan vigente y la tarea pasa a building. No se puede aprobar un plan que supera los
límites de tamaño: pide cambios o rechaza.
Si el plan cambió mientras decidías, sale con 4 sin hacer nada: lee el plan otra vez antes de
decidir. No repitas el comando a ciegas.

Ejemplo:
  togi plan approve 12
`,
  async run({ home, json, out, args }) {
    const n = planNumber(args, "togi plan approve --help");
    const done = await decidePlan(home, n, "approve");
    if (json) return `${JSON.stringify(done)}\n`;
    return `${out.mark("ok", say("plan_approved", { n: Number(n), state: done?.state ?? "building" }))}\n`;
  },
};

const requestChanges: Command = {
  summary: "Pide cambios sobre el plan vigente.",
  example: 'togi plan request-changes 12 --category scope --reason "Divídelo en dos"',
  options: REASON_OPTIONS,
  usage: `Uso: togi plan request-changes <número> --category <categoría> --reason <texto> [--json]

Pide un plan nuevo: la tarea vuelve a planning y el planificador propone la versión siguiente.

Categorías: ${REASON_CATEGORIES.join(", ")}

Si el plan cambió mientras decidías, sale con 4 sin hacer nada: lee el plan otra vez antes de
decidir. No repitas el comando a ciegas.

Ejemplo:
  togi plan request-changes 12 --category scope --reason "Divídelo en dos"
`,
  async run({ home, json, out, values, args }) {
    const command = "togi plan request-changes --help";
    const n = planNumber(args, command);
    const done = await decidePlan(home, n, "request-changes", reasonOf(values, command));
    if (json) return `${JSON.stringify(done)}\n`;
    return `${out.mark("ok", say("plan_changes_requested", { n: Number(n) }))}\n`;
  },
};

const reject: Command = {
  summary: "Rechaza el plan y cierra la tarea (definitivo).",
  example: 'togi plan reject 12 --category scope --reason "Duplica la #9"',
  options: { ...REASON_OPTIONS, yes: { type: "boolean", short: "y" } },
  usage: `Uso: togi plan reject <número> --category <categoría> --reason <texto> [--yes] [--json]

Rechaza el plan y la tarea. Es definitivo: la tarea queda cerrada. Pide confirmación en una
terminal; --yes la omite y fuera de una terminal es obligatorio.

Categorías: ${REASON_CATEGORIES.join(", ")}

Si el plan cambió mientras decidías, sale con 4 sin hacer nada: lee el plan otra vez antes de
decidir. No repitas el comando a ciegas.

Ejemplo:
  togi plan reject 12 --category scope --reason "Duplica la #9"
`,
  async run({ home, json, out, values, args, interactive, confirm }) {
    const command = "togi plan reject --help";
    const n = planNumber(args, command);
    const reason = reasonOf(values, command);
    const yes = values.yes === true;
    if (!yes && !interactive) {
      throw usageError("confirmation_required", { n: Number(n), command });
    }
    const done = await decidePlan(home, n, "reject", { ...reason, ...(yes ? {} : { confirm }) });
    if (done === null) return `${say("reject_cancelled")}\n`;
    if (json) return `${JSON.stringify(done)}\n`;
    return `${out.mark("ok", say("plan_rejected", { n: done.number }))}\n`;
  },
};

export const decisions = { approve, "request-changes": requestChanges, reject };
