import { randomUUID } from "node:crypto";
import { CreateTask, RISK_LEVELS } from "@togi/core";
import { usageError } from "../errors.ts";
import { say } from "../format.ts";
import type { Output } from "../output.ts";
import {
  type Created,
  createdLines,
  inferredLine,
  postTask,
  type RepoBase,
  resolveRepoBase,
} from "./create-task.ts";
import { resolveEditor, runEditor } from "./editor.ts";
import type { Command } from "./index.ts";
import { buildNewTemplate, parseNewTemplate, SUGGESTED_RISK } from "./new-template.ts";
import { submitTask } from "./task-flow.ts";

/** Campo de la API → cómo lo nombra quien usa la CLI. */
const FIELD: Record<string, string> = {
  title: "el título",
  description: "la descripción",
  acceptanceCriteria: "el criterio de aceptación",
  risk: "--risk",
};

export interface NewInput {
  risk: string | undefined;
  repo: string | undefined;
  base: string | undefined;
  /** No enviar a planificar aunque haya criterio. */
  draft: boolean;
}

export interface NewResult {
  created: Created;
  deduced: RepoBase["deduced"];
  /** El estado tras enviarla; `null` si se quedó en draft. */
  submitted: { state: string } | null;
}

/**
 * Crea una tarea con el editor y, si hay criterio de aceptación y no se pidió `--draft`, la envía.
 * El repo y la rama se resuelven antes de abrir el editor, para fallar pronto. Sin criterio la tarea
 * se crea en draft (enviar la rechazaría) y no se pierde lo escrito. `null` si cancela (nada escrito).
 */
export async function newWithEditor(
  home: string,
  editor: string[],
  input: NewInput,
  command = "togi new --help",
): Promise<NewResult | null> {
  if (input.risk !== undefined && !(RISK_LEVELS as readonly string[]).includes(input.risk)) {
    throw usageError("invalid_option", {
      field: "--risk",
      detail: RISK_LEVELS.join(", "),
      command,
    });
  }
  const target = await resolveRepoBase(home, { repo: input.repo, base: input.base }, command);
  const text = parseNewTemplate(
    await runEditor(
      editor,
      buildNewTemplate({
        repo: target.repo,
        baseBranch: target.baseBranch,
        risk: input.risk ?? SUGGESTED_RISK,
      }),
    ),
  );
  if (text === null) return null;
  const parsed = CreateTask.safeParse({
    ...text,
    repo: target.repo,
    ...(target.baseBranch === undefined ? {} : { baseBranch: target.baseBranch }),
  });
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    throw usageError("invalid_option", {
      field: FIELD[field] ?? field,
      ...(field === "risk" && { detail: RISK_LEVELS.join(", ") }),
      command,
    });
  }
  const created = await postTask(home, parsed.data, randomUUID());
  const submitted =
    input.draft || !created.hasCriteria ? null : await submitTask(home, String(created.number));
  return { created, deduced: target.deduced, submitted };
}

/**
 * El editor de `togi new`. Son dos fallos distintos y cada uno dice lo suyo: sin terminal (o con
 * `--json`) no se puede abrir un editor; con terminal pero sin `$VISUAL` ni `$EDITOR`, no se sabe
 * cuál abrir.
 */
export function editorForNew(
  ctx: { interactive: boolean; json: boolean },
  env: Record<string, string | undefined>,
  command: string,
): string[] {
  if (ctx.json || !ctx.interactive) throw usageError("new_needs_terminal", { command });
  const editor = resolveEditor(env);
  if (editor === undefined) throw usageError("new_needs_editor", { command });
  return editor;
}

export const newTaskWithEditor: Command = {
  summary: "Crea una tarea con el editor y la envía a planificar.",
  example: "togi new",
  options: {
    risk: { type: "string", short: "r" },
    repo: { type: "string" },
    base: { type: "string" },
    draft: { type: "boolean" },
  },
  usage: `Uso: togi new [--risk <low|medium|high>] [--repo <owner/repo>] [--base <rama>] [--draft]

Abre $VISUAL o $EDITOR con una plantilla de título, descripción, criterio de aceptación y riesgo
(sugerido: medium, o el de --risk). Crea la tarea con el repo y la rama que se deducen del
directorio, como togi task new, y la envía a planificar. Necesita una terminal; fuera de ella usa
togi task new y togi task submit.

  --draft   No la envía: se queda en draft.

Sin criterio de aceptación la tarea se crea en draft y no se envía: añádelo con
togi task edit <n> --criteria y envíala con togi task submit <n>. Si guardas el fichero sin
título, descripción ni criterio, se cancela y no se crea nada.

Ejemplo:
  togi new --risk low
`,
  async run({ home, json, out, values, args, interactive }) {
    const command = "togi new --help";
    if (args.length > 0) {
      throw usageError("invalid_option", {
        field: "el título",
        detail: "se escribe en el editor",
        command,
      });
    }
    const editor = editorForNew({ interactive, json }, process.env, command);
    const str = (v: string | boolean | undefined) => (typeof v === "string" ? v : undefined);
    const done = await newWithEditor(
      home,
      editor,
      {
        risk: str(values.risk),
        repo: str(values.repo),
        base: str(values.base),
        draft: values.draft === true,
      },
      command,
    );
    if (done === null) {
      process.stderr.write(`${say("new_cancelled")}\n`);
      return "";
    }
    return newLines(done, out);
  },
};

/** Lo creado, lo deducido y lo que sigue: enviada con su pista, o en draft con cómo seguir. */
export function newLines(done: NewResult, out: Output): string {
  const n = done.created.number;
  const lines = [createdLines(done.created, out).trimEnd()];
  if (done.deduced !== undefined) lines.push(`  ${inferredLine(done.deduced)}`);
  if (done.submitted !== null) {
    lines.push(out.mark("ok", say("task_submitted", { n, state: done.submitted.state })));
    lines.push(`  ${say("follow_hint", { n })}`);
  } else if (done.created.hasCriteria) {
    lines.push(`  ${say("new_draft_kept", { n })}`);
  }
  return `${lines.join("\n")}\n`;
}
