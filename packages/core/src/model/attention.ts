import { type BrandToken, STATE_BRAND } from "./state-brand.ts";
import { TASK_STATES, type TaskState } from "./task.ts";

/**
 * Agrupación de las tareas por quién tiene que actuar: la que usan `togi status` y la app. No sale
 * del color del estado (`draft` es `ink-muted` y espera a una persona).
 */
export const ATTENTION_GROUPS = ["pending", "active", "closed"] as const;
export type AttentionGroup = (typeof ATTENTION_GROUPS)[number];

const GROUP: Record<TaskState, AttentionGroup> = {
  draft: "pending",
  plan_review: "pending",
  review: "pending",
  failed: "pending",
  planning: "active",
  building: "active",
  verifying: "active",
  merged: "closed",
  rejected: "closed",
};

/** El grupo de un estado. Uno que esta versión no conoce (un daemon más nuevo) va a «closed». */
export const attentionGroup = (state: TaskState): AttentionGroup => GROUP[state] ?? "closed";

/** Los estados de un grupo, en el orden de la tabla de estados. */
export const statesIn = (group: AttentionGroup): TaskState[] =>
  TASK_STATES.filter((state) => GROUP[state] === group);

/** El color de marca de un estado (`human`, `agent`, `ink-muted` o `done`), que es el de su variable CSS. */
export const stateColor = (state: TaskState): BrandToken => STATE_BRAND[state].token;
