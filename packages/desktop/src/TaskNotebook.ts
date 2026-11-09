import { STATE_BRAND, stateColor, type TaskState } from "@togi/core";
import { createElement, type ReactNode } from "react";
import type { Review } from "./notebook.ts";
import { PlanNotebook, RISK_LABEL, type TaskCover } from "./PlanNotebook.ts";
import type { Decision } from "./planDecision.ts";
import { StateGlyph } from "./StateGlyph.ts";

// El centro cuando se elige una tarea (ADR-010 §2): el cuaderno del plan si está en `plan_review`
// y, para el resto, su portada y su estado. No habla con el daemon: `TaskNotebookPane` lee y decide.
// Todo el texto del daemon se pinta como nodo de texto de React, nunca como HTML. Sin JSX a propósito.

/** La portada de una tarea sin plan por revisar: título, criterio y el estado en el que está. */
function Cover({ task, state }: { task: TaskCover; state: TaskState }): ReactNode {
  const noTitle = task.titleErased || task.title === null;
  const noLede = task.criteriaErased || task.criteria === null || task.criteria.trim() === "";
  const tone = Object.hasOwn(STATE_BRAND, state) ? stateColor(state) : "ink-muted";
  return createElement(
    "article",
    { className: "notebook" },
    createElement(
      "header",
      { className: "notebook-cover" },
      createElement(
        "p",
        { className: "notebook-context" },
        [task.repo, `#${task.number}`, RISK_LABEL[task.risk] ?? "riesgo desconocido"].join(" · "),
      ),
      createElement(
        "h1",
        { className: noTitle ? "muted" : undefined },
        noTitle ? "[borrado]" : task.title,
      ),
      createElement(
        "p",
        { className: noLede ? "notebook-lede muted" : "notebook-lede" },
        noLede
          ? task.criteriaErased
            ? "[borrado]"
            : "Falta el criterio de aceptación."
          : task.criteria,
      ),
    ),
    createElement(
      "p",
      { className: `task-state tone-${tone}` },
      createElement(StateGlyph, { state }),
      createElement("span", null, state),
    ),
  );
}

export function TaskNotebook({
  review,
  state,
  notice,
  busy,
  onDecide,
}: {
  review: Review;
  state: TaskState;
  notice: string | null;
  busy: boolean;
  onDecide: (decision: Decision) => void;
}): ReactNode {
  let body: ReactNode;
  if (review.status === "loading") {
    body = createElement("p", { className: "muted" }, "Leyendo la tarea…");
  } else if (review.status === "error") {
    body = createElement(
      "p",
      { className: "muted" },
      `No se pudo leer la tarea (${review.reason}).`,
    );
  } else if (review.plan === null) {
    body = createElement(Cover, { task: review.task, state });
  } else {
    // Con otra versión del plan el formulario a medias se descarta: el motivo era del plan anterior.
    body = createElement(PlanNotebook, {
      key: review.version,
      task: review.task,
      plan: review.plan,
      busy,
      onDecide,
    });
  }
  return createElement(
    "div",
    { className: "task-notebook" },
    notice === null
      ? null
      : createElement("p", { role: "status", className: "notebook-notice" }, notice),
    body,
  );
}
