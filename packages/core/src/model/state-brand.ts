import type { TaskState } from "./task.ts";

/** Tokens de color del manual de marca que usan los estados. */
export type BrandToken = "ink-muted" | "agent" | "human" | "done";

export interface StateBrand {
  glyph: string;
  token: BrandToken;
  /** Texto de ejemplo del manual; las frases reales llevan datos (versión, ciclo, motivo). */
  text: string;
}

/** Única fuente de glifos, tokens y textos de estado: «Estados de una tarea» del manual de marca. */
export const STATE_BRAND: Record<TaskState, StateBrand> = {
  draft: { glyph: "○", token: "ink-muted", text: "Falta el criterio de aceptación" },
  planning: { glyph: "◐", token: "agent", text: "Preparando el plan" },
  plan_review: { glyph: "◆", token: "human", text: "Plan v2 · espera tu aprobación" },
  building: { glyph: "◐", token: "agent", text: "Ciclo 1 de 3" },
  verifying: { glyph: "◑", token: "agent", text: "3 de 5 gates completados" },
  review: { glyph: "◆", token: "human", text: "Gates en verde · espera tu revisión" },
  merged: { glyph: "●", token: "done", text: "Mergeada en dev" },
  failed: { glyph: "✕", token: "human", text: "3 ciclos sin pasar los gates" },
  rejected: { glyph: "—", token: "ink-muted", text: "Rechazada: [motivo]" },
};
