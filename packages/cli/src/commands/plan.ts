import { PLAN_LIMITS } from "@togi/core";
import { type Client, createClient } from "../client.ts";
import { CliError, usageError } from "../errors.ts";
import { clean, oneLine, say } from "../format.ts";
import { failedSession, type SessionSummary } from "../last-session.ts";
import type { Output } from "../output.ts";
import type { Command } from "./index.ts";
import { decisions } from "./plan-decide.ts";
import { retry } from "./plan-retry.ts";

const NUMBER = /^[1-9]\d*$/;

interface PlanSummary {
  planVersion: number;
  baseSha: string;
  files: { path: string; change: string }[];
  newTests: string[];
  estimatedLines: { production: number; tests: number };
}

interface Plan extends PlanSummary {
  approach: string;
  approachErased: boolean;
  previous: PlanSummary[];
}

const exceedsLimits = ({ production, tests }: PlanSummary["estimatedLines"]) =>
  production > PLAN_LIMITS.maxProductionLines || production + tests > PLAN_LIMITS.maxTotalLines;

/** Una versión del plan: la vigente con su enfoque, o una anterior, que no lo conserva. */
function render(
  n: number,
  plan: PlanSummary,
  approach: string | null,
  out: Output,
  failed?: SessionSummary,
): string {
  const { production, tests } = plan.estimatedLines;
  const lines = [
    `${out.paint("accent", `#${n}`)}  plan · versión ${plan.planVersion}`,
    `${" ".repeat(`#${n}`.length + 2)}base ${oneLine(plan.baseSha)} · ${say("plan_lines", { production, tests })}`,
  ];
  if (exceedsLimits(plan.estimatedLines)) {
    const limit = `${PLAN_LIMITS.maxProductionLines} de producción, ${PLAN_LIMITS.maxTotalLines} en total`;
    lines.push(out.mark("attention", say("plan_exceeds", { limit })));
  }
  lines.push("", say("section_plan_files"));
  for (const f of plan.files) {
    lines.push(`  ${say(`plan_change_${oneLine(f.change)}`).padEnd(10)} ${oneLine(f.path)}`);
  }
  lines.push("", say("section_plan_tests"));
  if (plan.newTests.length === 0) lines.push(`  ${out.paint("muted", say("text_empty"))}`);
  for (const t of plan.newTests) lines.push(`  ${oneLine(t)}`);
  lines.push("", say("section_plan_approach"));
  if (approach === null) lines.push(`  ${out.paint("muted", say("plan_older"))}`);
  else for (const l of clean(approach).split("\n")) lines.push(`  ${l}`);
  if (failed)
    lines.push(
      "",
      out.mark("attention", say("last_session_failed", { reason: failed.failureReason ?? "" })),
    );
  return `${lines.join("\n")}\n`;
}

/** El plan vigente con su enfoque, como lo muestra `togi plan show`. */
function renderCurrent(n: number, plan: Plan, out: Output, failed?: SessionSummary): string {
  const approach = plan.approachErased ? say("text_erased") : plan.approach;
  return render(n, plan, approach, out, failed);
}

/** Lo mismo que `togi plan show <n>` sin flags, para quien sigue una tarea hasta su plan. */
export async function currentPlanText(client: Client, n: string, out: Output): Promise<string> {
  const plan = await client.checked<Plan>(
    await client.api.v1.tasks[":n"].plan.$get({ param: { n } }),
    { n: Number(n) },
  );
  return renderCurrent(Number(n), plan, out, await failedSession(client, n));
}

const show: Command = {
  summary: "Muestra el plan de una tarea.",
  example: "togi plan show 12",
  options: { version: { type: "string" } },
  usage: `Uso: togi plan show <número> [--version <v>] [--json]

Muestra el plan vigente: ficheros con su tipo de cambio, tests nuevos, enfoque, líneas
estimadas, la rama base (sha) y la versión. Avisa si pasa de los límites (${PLAN_LIMITS.maxProductionLines} líneas de
producción, ${PLAN_LIMITS.maxTotalLines} en total).
Con --version se ve una versión anterior, sin enfoque: solo se conserva el de la vigente.

Ejemplo:
  togi plan show 12 --version 1
`,
  async run({ home, json, out, values, args }) {
    const command = "togi plan show --help";
    const n = args[0];
    if (n === undefined)
      throw usageError("missing_option", { field: "el número de tarea", command });
    if (args.length > 1 || !NUMBER.test(n)) {
      throw usageError("invalid_option", { field: "el número de tarea", command });
    }
    const wanted = values.version;
    if (wanted !== undefined && (typeof wanted !== "string" || !NUMBER.test(wanted))) {
      throw usageError("invalid_option", { field: "--version", command });
    }
    const client = createClient(home);
    let plan: Plan;
    try {
      plan = await client.checked<Plan>(
        await client.api.v1.tasks[":n"].plan.$get({ param: { n } }),
        { n: Number(n) },
      );
    } catch (error) {
      // Sin plan, lo útil es saber por qué la última sesión terminó mal.
      const failed =
        error instanceof CliError &&
        error.code === "plan_not_found" &&
        (await failedSession(client, n));
      if (error instanceof CliError && failed) {
        throw new CliError(
          error.code,
          error.exitCode,
          { ...error.context, reason: failed.failureReason ?? "" },
          error.status,
          error.stdout,
        );
      }
      throw error;
    }
    const version = wanted === undefined ? plan.planVersion : Number(wanted);
    if (version === plan.planVersion) {
      const failed = await failedSession(client, n);
      if (json) return `${JSON.stringify({ ...plan, lastSession: failed ?? null })}\n`;
      return renderCurrent(Number(n), plan, out, failed);
    }
    const older = plan.previous.find((p) => p.planVersion === version);
    if (older === undefined) {
      throw new CliError("plan_version_not_found", 7, { n: Number(n), version });
    }
    if (json) return `${JSON.stringify(older)}\n`;
    return render(Number(n), older, null, out);
  },
};

export const plan = { show, retry, ...decisions };
