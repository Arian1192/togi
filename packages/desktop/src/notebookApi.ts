import { invoke } from "@tauri-apps/api/core";
import {
  type Outcome,
  type PlanReadResult,
  type Review,
  reviewFrom,
  type TaskReadResult,
} from "./notebook.ts";
import type { Decision } from "./planDecision.ts";

// Los comandos de Tauri que usa el cuaderno. Cada `invoke` lleva su nombre escrito: así
// frontend-boundary.test.ts los ve todos y la lista de comandos permitidos sigue cerrada. El webview
// solo pasa el número de tarea, la versión que vio y el motivo; la ruta, el método y las
// credenciales los pone el lado Rust, que además pide la confirmación con un diálogo nativo.

/** Lee la portada y, si `withPlan`, el plan vigente. La versión es la del plan leído. */
export async function loadReview(number: number, withPlan: boolean): Promise<Review> {
  const [task, plan] = await Promise.all([
    invoke<TaskReadResult>("read_task", { number }),
    withPlan ? invoke<PlanReadResult>("read_plan", { number }) : Promise.resolve(undefined),
  ]).catch(() => [null, null] as const);
  return reviewFrom(task, plan);
}

/** Envía una decisión sobre el plan que se leyó (`version`); el daemon la rechaza si ya cambió. */
export function sendDecision(
  number: number,
  version: number,
  decision: Decision,
): Promise<Outcome> {
  const args = { number, version };
  if (decision.kind === "approve") return invoke<Outcome>("approve_plan", args);
  const reason = { ...args, category: decision.category, text: decision.text };
  return decision.kind === "reject"
    ? invoke<Outcome>("reject_plan", reason)
    : invoke<Outcome>("request_plan_changes", reason);
}
