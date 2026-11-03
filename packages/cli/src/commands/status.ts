import { TASK_STATES } from "@togi/core";
import { createClient } from "../client.ts";
import { usageError } from "../errors.ts";
import { PAGE, renderStatus, type StatusTask } from "../status-view.ts";
import type { Command } from "./index.ts";

export const status: Command = {
  summary: "Muestra las tareas: lo que espera una decisión y lo que está en curso.",
  example: "togi status --all",
  usage: `Uso: togi status [--state <estado>] [--all] [--json]

Lista las tareas en dos grupos: «Pendiente de ti» (draft, plan_review, review, failed) y
«En curso» (planning, building, verifying). Las cerradas (merged, rejected) se ocultan y se cuentan.

  --state  Solo las tareas de ese estado (${TASK_STATES.join(", ")}).
  --all    Incluye las cerradas.

Ejemplo:
  togi status --state review
`,
  options: { state: { type: "string" }, all: { type: "boolean" } },
  async run({ home, json, out, values, args }) {
    const command = "togi status --help";
    if (args.length > 0) {
      throw usageError("invalid_option", {
        field: "un argumento",
        detail: "togi status no admite ninguno",
        command,
      });
    }
    const state = typeof values.state === "string" ? values.state : undefined;
    if (state !== undefined && !(TASK_STATES as readonly string[]).includes(state)) {
      throw usageError("invalid_option", {
        field: "--state",
        detail: TASK_STATES.join(", "),
        command,
      });
    }
    const client = createClient(home);
    const body = await client.checked<{ tasks: StatusTask[] }>(
      await client.api.v1.tasks.$get({
        query: { limit: String(PAGE), ...(state === undefined ? {} : { state }) },
      }),
    );
    if (json) return `${JSON.stringify(body)}\n`;
    return renderStatus(
      body.tasks,
      { all: values.all === true, ...(state && { state }) },
      out,
      new Date(),
    );
  },
};
