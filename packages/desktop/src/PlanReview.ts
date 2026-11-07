import { createElement, type ReactNode } from "react";
import { type PlanData, PlanNotebook, type TaskCover } from "./PlanNotebook.ts";
import type { Decision } from "./planDecision.ts";

// La pantalla de revisión de un plan: lo que App.tsx lee del daemon (por los comandos `read_task` y
// `read_plan`), el aviso del último intento y el cuaderno. No habla con el daemon: App.tsx decide.

export type Review =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ready"; task: TaskCover; plan: PlanData; version: number };

const button = (label: string, onClick: () => void): ReactNode =>
  createElement("button", { type: "button", className: "btn btn-secondary", onClick }, label);

export function PlanReview({
  review,
  notice,
  busy,
  onDecide,
  onBack,
}: {
  review: Review;
  notice: string | null;
  busy: boolean;
  onDecide: (decision: Decision) => void;
  onBack: () => void;
}): ReactNode {
  const body =
    review.status === "ready"
      ? // Con otra versión del plan el formulario a medias se descarta: el motivo era del plan anterior.
        createElement(PlanNotebook, {
          key: review.version,
          task: review.task,
          plan: review.plan,
          busy,
          onDecide,
        })
      : createElement(
          "p",
          { className: "muted" },
          review.status === "loading"
            ? "Leyendo el plan…"
            : `No se pudo leer el plan (${review.reason}).`,
        );
  return createElement(
    "div",
    { className: "plan-review" },
    button("Volver a la lista", onBack),
    notice === null
      ? null
      : createElement("p", { role: "status", className: "notebook-notice" }, notice),
    body,
  );
}
