import type { PlanData, TaskCover } from "./PlanNotebook.ts";

// Lo que hay entre los comandos del daemon y el cuaderno de una tarea, sin pintar ni invocar nada:
// qué se ha leído, y qué hacer con el resultado de una decisión.

/** Lo que devuelve `read_task` (task.rs): los motivos de `unreachable` son cerrados. */
export type TaskReadResult =
  | { status: "ok"; task: TaskCover }
  | { status: "unreachable"; reason: string };

/** Lo que devuelve `read_plan` (plan.rs); `version` es la de la tarea, la que se manda al decidir. */
export type PlanReadResult =
  | { status: "ok"; plan: PlanData; version: number }
  | { status: "unreachable"; reason: string };

/** Lo que devuelve una decisión (plan.rs): los motivos de `failed` son cerrados, nunca texto del daemon. */
export type Outcome =
  | { status: "ok" | "plan_changed" | "cancelled" }
  | { status: "failed"; reason: string };

export type Review =
  | { status: "loading" }
  | { status: "error"; reason: string }
  /** `plan` y `version` son `null` si la tarea no tiene un plan por revisar. */
  | { status: "ready"; task: TaskCover; plan: PlanData | null; version: number | null };

/**
 * Junta lo leído. `plan` es `undefined` si no se pidió (la tarea no está en `plan_review`) y `null`
 * si la lectura falló del todo. Todo o nada: con un fallo no se enseña nada a medias.
 */
export function reviewFrom(
  task: TaskReadResult | null,
  plan: PlanReadResult | null | undefined,
): Review {
  const failed = [task, plan].find((r) => r?.status === "unreachable");
  if (failed?.status === "unreachable") return { status: "error", reason: failed.reason };
  if (task?.status !== "ok" || plan === null) return { status: "error", reason: "app" };
  if (plan === undefined) return { status: "ready", task: task.task, plan: null, version: null };
  if (plan.status !== "ok") return { status: "error", reason: "app" };
  return { status: "ready", task: task.task, plan: plan.plan, version: plan.version };
}

export const PLAN_CHANGED =
  "El plan cambió mientras lo leías. Este es el nuevo: léelo antes de decidir.";

export type Effect =
  | { kind: "reload"; notice: string | null }
  | { kind: "notice"; notice: string }
  | { kind: "none" };

/** Qué hace la pantalla con el resultado de una decisión. */
export function outcomeEffect(out: Outcome): Effect {
  switch (out.status) {
    case "ok":
      return { kind: "reload", notice: null };
    case "plan_changed":
      return { kind: "reload", notice: PLAN_CHANGED };
    case "cancelled":
      return { kind: "none" };
    case "failed":
      return {
        kind: "notice",
        notice: `No se pudo enviar la decisión (${out.reason}). El plan sigue sin decidir.`,
      };
  }
}
