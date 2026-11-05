import {
  type BlobRef,
  evolve,
  isTaskEvent,
  NO_TASK,
  type PlannerPromptInput,
  type TaskView,
  toDomainEvent,
} from "@togi/core";
import type Database from "better-sqlite3";
import type { SqliteEventStore } from "../store/event-store.ts";

const ERASED = "[borrado]";

export interface TaskTextSource {
  db: Database.Database;
  store: SqliteEventStore;
  readText(ref: BlobRef): Promise<string>;
}

/**
 * Lo que el prompt necesita de una tarea, salido del log y de las proyecciones. Si el último
 * veredicto sobre el plan vigente fue «pedir cambios», incluye ese plan y su motivo: ambos son texto
 * del usuario o del agente anterior, y el prompt los marca como tales.
 */
export async function taskPromptInput(
  { db, store, readText }: TaskTextSource,
  number: number,
): Promise<Omit<PlannerPromptInput, "instructions" | "nonce">> {
  let view: TaskView = NO_TASK;
  for await (const stored of store.readStream(`task:${number}`)) {
    const event = toDomainEvent(stored);
    if (isTaskEvent(event)) view = evolve(view, event);
  }
  if (!view.exists) throw new Error(`la tarea ${number} no existe`);
  const optional = async (ref: BlobRef | null) => (ref === null ? null : readText(ref));
  const row = db.prepare("SELECT repo, base_branch FROM tasks WHERE number = ?").get(number) as {
    repo: string;
    base_branch: string;
  };
  const input: Omit<PlannerPromptInput, "instructions" | "nonce"> = {
    task: {
      title: await readText(view.title),
      description: await optional(view.description),
      acceptanceCriteria: await optional(view.acceptanceCriteria),
    },
    repo: { name: row.repo, baseBranch: row.base_branch },
  };

  const plan = db
    .prepare("SELECT * FROM plans WHERE task_number = ? ORDER BY plan_version DESC LIMIT 1")
    .get(number) as Record<string, string | number> | undefined;
  const decision = db
    .prepare(
      "SELECT verdict, plan_version, reason FROM decisions WHERE task_number = ? ORDER BY seq DESC LIMIT 1",
    )
    .get(number) as { verdict: string; plan_version: number; reason: string | null } | undefined;
  if (
    plan === undefined ||
    decision?.verdict !== "request_changes" ||
    decision.plan_version !== plan.plan_version ||
    decision.reason === null
  ) {
    return input;
  }
  const text = async (ref: BlobRef) => readText(ref).catch(() => ERASED);
  const reason = JSON.parse(decision.reason) as { category: string; text: BlobRef };
  const previousPlan = JSON.stringify({
    files: JSON.parse(plan.files as string),
    newTests: JSON.parse(plan.new_tests as string),
    estimatedLines: { production: plan.estimated_production, tests: plan.estimated_tests },
    approach: await text(JSON.parse(plan.approach as string) as BlobRef),
  });
  return {
    ...input,
    changeRequest: {
      previousPlan,
      reason: `${reason.category}: ${await text(reason.text)}`,
    },
  };
}
