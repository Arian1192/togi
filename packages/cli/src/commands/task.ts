import { randomUUID } from "node:crypto";
import { CreateTask, RISK_LEVELS, SAFE_ID } from "@togi/core";
import { createClient } from "../client.ts";
import { usageError } from "../errors.ts";
import { clean } from "../format.ts";
import { MESSAGES } from "../messages.ts";
import type { Output } from "../output.ts";
import type { Command } from "./index.ts";

interface Created {
  number: number;
  title: string;
  state: string;
  risk: string;
  hasCriteria: boolean;
}

/** Campo de la API → cómo lo nombra la persona que usa la CLI. */
const FLAG: Record<string, string> = {
  title: "el título",
  risk: "--risk",
  repo: "--repo",
  baseBranch: "--base",
  description: "--description",
  acceptanceCriteria: "--criteria",
};

const str = (v: string | boolean | undefined) => (typeof v === "string" ? v : undefined);

const NEW_USAGE = `Uso: togi task new "<título>" --risk <low|medium|high> --repo <owner/repo> [--base dev]
                    [--description <texto>] [--criteria <texto>] [--idempotency-key <clave>]

Crea una tarea en draft. Sin --description se crea vacía.

  --idempotency-key  Repetir el comando con la misma clave no crea otra tarea.
                     Sin ella, cada ejecución genera la suya.

Ejemplo:
  togi task new "Exportar CSV" --risk low --repo Arian1192/promos --criteria "Descarga un .csv"
`;

const newTask: Command = {
  summary: "Crea una tarea.",
  example: 'togi task new "Exportar CSV" --risk low --repo Arian1192/promos',
  usage: NEW_USAGE,
  options: {
    risk: { type: "string", short: "r" },
    repo: { type: "string" },
    base: { type: "string" },
    description: { type: "string" },
    criteria: { type: "string" },
    "idempotency-key": { type: "string" },
  },
  async run({ home, json, out, values, args }) {
    const command = "togi task new --help";
    const missing = (field: string) => usageError("missing_option", { field, command });
    if (args.length === 0) throw missing(FLAG.title as string);
    if (args.length > 1) {
      throw usageError("invalid_option", {
        field: FLAG.title as string,
        detail: "va entre comillas",
        command,
      });
    }
    if (str(values.risk) === undefined) throw missing("--risk");
    if (str(values.repo) === undefined) throw missing("--repo");
    const key = str(values["idempotency-key"]) ?? randomUUID();
    if (!SAFE_ID.test(key)) {
      throw usageError("invalid_option", { field: "--idempotency-key", command });
    }
    const body = {
      title: args[0],
      risk: str(values.risk),
      repo: str(values.repo),
      ...(values.base === undefined ? {} : { baseBranch: str(values.base) }),
      ...(values.description === undefined ? {} : { description: str(values.description) }),
      ...(values.criteria === undefined ? {} : { acceptanceCriteria: str(values.criteria) }),
    };
    const parsed = CreateTask.safeParse(body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "");
      throw usageError("invalid_option", {
        field: FLAG[field] ?? field,
        ...(field === "risk" && { detail: RISK_LEVELS.join(", ") }),
        command,
      });
    }
    const client = createClient(home);
    const created = await client.checked<Created>(
      await client.api.v1.tasks.$post(
        {},
        {
          headers: { "idempotency-key": key, "content-type": "application/json" },
          init: { body: JSON.stringify(parsed.data) },
        },
      ),
    );
    if (json) return `${JSON.stringify(created)}\n`;
    return createdLines(created, out);
  },
};

function createdLines(t: Created, out: Output): string {
  const params = { n: t.number, title: clean(t.title), risk: t.risk, state: t.state };
  const lines = [out.mark("ok", MESSAGES.task_created?.(params).text ?? "")];
  if (!t.hasCriteria) {
    const next = MESSAGES.task_missing_criteria?.(params);
    lines.push(`  ${next?.text}: ${out.paint("accent", next?.next?.command ?? "")}`);
  }
  return `${lines.join("\n")}\n`;
}

export const task = { new: newTask };
