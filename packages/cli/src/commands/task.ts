import { randomUUID } from "node:crypto";
import { CreateTask, RISK_LEVELS, SAFE_ID } from "@togi/core";
import { createClient } from "../client.ts";
import { usageError } from "../errors.ts";
import { clean, headerIndent, say, section } from "../format.ts";
import { failedSession } from "../last-session.ts";
import { createdLines, inferredLine, postTask, resolveRepoBase } from "./create-task.ts";
import type { Command } from "./index.ts";
import { flow } from "./task-flow.ts";

interface Detail {
  number: number;
  title: string | null;
  titleErased: boolean;
  state: string;
  risk: string;
  repo: string;
  baseBranch: string;
  version: number;
  planVersion: number | null;
  description: string | null;
  acceptanceCriteria: string | null;
  erased: { description: boolean; acceptanceCriteria: boolean };
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

const NUMBER = /^[1-9]\d*$/;
const str = (v: string | boolean | undefined) => (typeof v === "string" ? v : undefined);

const NEW_USAGE = `Uso: togi task new "<título>" --risk <low|medium|high> [--repo <owner/repo>] [--base dev]
                    [--description <texto>] [--criteria <texto>] [--idempotency-key <clave>]

Crea una tarea en draft. Sin --description se crea vacía.

  --repo, --base     Opcionales dentro de un clon registrado (togi repo add): el repo sale de su
                     remote origin y la rama base de origin/HEAD. Si no se pueden deducir, se
                     piden; nunca se suponen. Con --repo y sin --base, la rama es dev.

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
    const key = str(values["idempotency-key"]) ?? randomUUID();
    if (!SAFE_ID.test(key)) {
      throw usageError("invalid_option", { field: "--idempotency-key", command });
    }
    const { repo, baseBranch, deduced } = await resolveRepoBase(
      home,
      { repo: str(values.repo), base: values.base === undefined ? undefined : str(values.base) },
      command,
    );
    const body = {
      title: args[0],
      risk: str(values.risk),
      repo,
      ...(baseBranch === undefined ? {} : { baseBranch }),
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
    const created = await postTask(home, parsed.data, key);
    if (json) return `${JSON.stringify(created)}\n`;
    const lines = createdLines(created, out);
    return deduced === undefined ? lines : `${lines}  ${inferredLine(deduced)}\n`;
  },
};

const show: Command = {
  summary: "Muestra el detalle de una tarea.",
  example: "togi task show 12",
  usage: `Uso: togi task show <número> [--json]

Muestra el estado, el repositorio y los textos de una tarea.

Ejemplo:
  togi task show 12
`,
  async run({ home, json, out, args }) {
    const command = "togi task show --help";
    const n = args[0];
    if (n === undefined)
      throw usageError("missing_option", { field: "el número de tarea", command });
    if (args.length > 1 || !NUMBER.test(n)) {
      throw usageError("invalid_option", { field: "el número de tarea", command });
    }
    const client = createClient(home);
    const t = await client.checked<Detail>(await client.api.v1.tasks[":n"].$get({ param: { n } }), {
      n: Number(n),
    });
    if (json) return `${JSON.stringify(t)}\n`;
    // Una tarea que espera plan y cuya última sesión falló: el porqué y el siguiente paso.
    const failed = t.state === "planning" ? await failedSession(client, n) : undefined;
    const risk = say(`risk_${t.risk}`);
    const meta = `${t.state} · riesgo ${risk} · ${t.repo} → ${t.baseBranch} · versión ${t.version}${
      t.planVersion === null ? "" : ` · plan v${t.planVersion}`
    }`;
    return `${[
      `${out.paint("accent", `#${t.number}`)}  ${
        t.titleErased || t.title === null ? out.paint("muted", say("text_erased")) : clean(t.title)
      }`,
      `${headerIndent(t.number)}${meta}`,
      "",
      section(say("section_description"), t.description, t.erased.description, out),
      "",
      section(say("section_criteria"), t.acceptanceCriteria, t.erased.acceptanceCriteria, out),
      ...(failed
        ? [
            "",
            out.mark(
              "attention",
              say("last_session_failed", { reason: failed.failureReason ?? "" }),
            ),
          ]
        : []),
    ].join("\n")}\n`;
  },
};

export const task = { new: newTask, show, ...flow };
