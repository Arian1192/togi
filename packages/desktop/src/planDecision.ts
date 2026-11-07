import { PLAN_LIMITS, REASON_CATEGORIES, type ReasonCategory } from "@togi/core";
import type { PlanData } from "./PlanNotebook.ts";

// La lógica de la decisión sobre un plan, sin pintar nada: qué decisiones existen, cuándo no se puede
// aprobar y cómo se rellena el motivo de un «pedir cambios» o un «rechazar».

export type Decision =
  | { kind: "approve" }
  | { kind: "request_changes" | "reject"; category: ReasonCategory; text: string };

export const CATEGORY_LABEL: Record<ReasonCategory, string> = {
  misunderstanding: "Malentendido",
  scope: "Alcance",
  logic: "Lógica",
  tests: "Tests",
  style: "Estilo",
  other: "Otro",
};

/** El límite del motivo en el daemon, en unidades UTF-16 (las de `String.length`). */
export const MAX_REASON = 5_000;

/** Por qué el plan no se puede aprobar (los límites de tamaño del ADR-007), o `null` si se puede. */
export function planProblem({ estimatedLines: { production, tests } }: PlanData): string | null {
  if (production > PLAN_LIMITS.maxProductionLines) {
    return `supera las ${PLAN_LIMITS.maxProductionLines} líneas de producción`;
  }
  if (production + tests > PLAN_LIMITS.maxTotalLines) {
    return `supera las ${PLAN_LIMITS.maxTotalLines} líneas en total`;
  }
  return null;
}

export interface FormState {
  kind: "request_changes" | "reject" | null;
  category: string;
  text: string;
}
export type FormAction =
  | { type: "open"; kind: "request_changes" | "reject" }
  | { type: "category" | "text"; value: string }
  | { type: "cancel" };

export const NO_FORM: FormState = { kind: null, category: "", text: "" };

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "open":
      return { ...NO_FORM, kind: action.kind };
    case "category":
      return { ...state, category: action.value };
    case "text":
      return { ...state, text: action.value };
    case "cancel":
      return NO_FORM;
  }
}

/** El motivo listo para enviar: categoría de la lista cerrada y texto no vacío y acotado. */
export function reasonOf({ category, text }: FormState) {
  const trimmed = text.trim();
  const valid = (REASON_CATEGORIES as readonly string[]).includes(category);
  if (!valid || trimmed === "" || trimmed.length > MAX_REASON) return null;
  return { category: category as ReasonCategory, text: trimmed };
}
