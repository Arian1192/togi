import { PLAN_LIMITS, REASON_CATEGORIES } from "@togi/core";
import { createElement, type ReactNode, useReducer } from "react";
import {
  CATEGORY_LABEL,
  type Decision,
  type FormAction,
  type FormState,
  formReducer,
  MAX_REASON,
  NO_FORM,
  planProblem,
  reasonOf,
} from "./planDecision.ts";

// El cuaderno del plan (manual de marca, «Patrones de interfaz»): una pantalla, una decisión. Recibe
// la tarea y el plan ya leídos y avisa de la decisión por `onDecide`; no habla con el daemon. Todo el
// texto del daemon (título, criterio, enfoque, rutas) se pinta como nodo de texto de React, nunca como
// HTML. Sin JSX a propósito, como TaskList: los tests corren con `node --test`.

/** La portada tal y como la devuelve el comando `read_task`. */
export interface TaskCover {
  number: number;
  title: string | null;
  titleErased: boolean;
  risk: string;
  repo: string;
  criteria: string | null;
  criteriaErased: boolean;
}

/** El plan tal y como lo devuelve el comando `read_plan`. */
export interface PlanData {
  planVersion: number;
  files: { path: string; change: string }[];
  newTests: string[];
  approach: string;
  approachErased: boolean;
  estimatedLines: { production: number; tests: number };
}

const KANJI = ["一", "二", "三", "四"] as const;
export const RISK_LABEL: Record<string, string> = {
  low: "riesgo bajo",
  medium: "riesgo medio",
  high: "riesgo alto",
};
const CHANGE_SIGN: Record<string, string> = { add: "+", modify: "~", delete: "−" };

const button = (primary: boolean, label: string, props: Record<string, unknown>): ReactNode =>
  createElement(
    "button",
    { type: "button", className: primary ? "btn btn-primary" : "btn btn-secondary", ...props },
    label,
  );

/** Una sección numerada con kanji, en `font-display` y `ink-muted`, delante del título. */
export function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children?: ReactNode;
}): ReactNode {
  return createElement(
    "section",
    { className: "notebook-section" },
    createElement(
      "h2",
      null,
      createElement("span", { className: "kanji", "aria-hidden": "true" }, KANJI[n]),
      title,
    ),
    children,
  );
}

function Cover({ task, plan }: { task: TaskCover; plan: PlanData }): ReactNode {
  const context = [
    task.repo,
    `#${task.number}`,
    RISK_LABEL[task.risk] ?? "riesgo desconocido",
    `plan v${plan.planVersion}`,
  ].join(" · ");
  const noTitle = task.titleErased || task.title === null;
  const noLede = task.criteriaErased || task.criteria === null || task.criteria.trim() === "";
  const lede = task.criteriaErased ? "[borrado]" : "Falta el criterio de aceptación.";
  return createElement(
    "header",
    { className: "notebook-cover" },
    createElement("p", { className: "notebook-context" }, context),
    createElement(
      "h1",
      { className: noTitle ? "muted" : undefined },
      noTitle ? "[borrado]" : task.title,
    ),
    createElement(
      "p",
      { className: noLede ? "notebook-lede muted" : "notebook-lede" },
      noLede ? lede : task.criteria,
    ),
  );
}

function Files({ plan }: { plan: PlanData }): ReactNode {
  const list = (sign: (i: number) => string, paths: string[]) =>
    createElement(
      "ul",
      { className: "notebook-files" },
      paths.map((path, i) =>
        createElement(
          "li",
          { key: `${i}${path}` },
          createElement("span", { className: "sign" }, sign(i)),
          createElement("code", null, path),
        ),
      ),
    );
  return createElement(
    "div",
    null,
    list(
      (i) => CHANGE_SIGN[plan.files[i]?.change ?? ""] ?? "?",
      plan.files.map((f) => f.path),
    ),
    plan.newTests.length === 0
      ? createElement("p", { className: "muted" }, "Sin tests nuevos.")
      : createElement(
          "div",
          null,
          createElement("p", { className: "notebook-subtitle" }, "Tests nuevos"),
          list(() => "+", plan.newTests),
        ),
  );
}

/** Motivo de un «pedir cambios» o un «rechazar»: categoría, texto y el verbo concreto al final. */
export function ReasonForm({
  state,
  busy,
  dispatch,
  onSubmit,
}: {
  state: FormState;
  busy: boolean;
  dispatch: (action: FormAction) => void;
  onSubmit: () => void;
}): ReactNode {
  return createElement(
    "div",
    { className: "notebook-form" },
    createElement(
      "label",
      null,
      "Categoría",
      createElement(
        "select",
        {
          value: state.category,
          onChange: (e: { target: { value: string } }) =>
            dispatch({ type: "category", value: e.target.value }),
        },
        createElement("option", { value: "", key: "none" }, "Elige una categoría"),
        REASON_CATEGORIES.map((c) =>
          createElement("option", { value: c, key: c }, CATEGORY_LABEL[c]),
        ),
      ),
    ),
    createElement(
      "label",
      null,
      "Motivo",
      createElement("textarea", {
        value: state.text,
        rows: 5,
        maxLength: MAX_REASON,
        onChange: (e: { target: { value: string } }) =>
          dispatch({ type: "text", value: e.target.value }),
      }),
    ),
    createElement(
      "div",
      { className: "notebook-actions" },
      button(true, state.kind === "reject" ? "Rechazar el plan" : "Enviar los cambios", {
        disabled: busy || reasonOf(state) === null,
        onClick: onSubmit,
      }),
      button(false, "Cancelar", { disabled: busy, onClick: () => dispatch({ type: "cancel" }) }),
    ),
  );
}

function Decide({
  plan,
  busy,
  onDecide,
}: {
  plan: PlanData;
  busy: boolean;
  onDecide: (decision: Decision) => void;
}): ReactNode {
  const [form, dispatch] = useReducer(formReducer, NO_FORM);
  const problem = planProblem(plan);
  if (form.kind !== null) {
    const kind = form.kind;
    const submit = () => {
      const reason = reasonOf(form);
      if (reason !== null) onDecide({ kind, ...reason });
    };
    return createElement(ReasonForm, { state: form, busy, dispatch, onSubmit: submit });
  }
  return createElement(
    "div",
    null,
    problem === null
      ? null
      : createElement(
          "p",
          { className: "notebook-problem" },
          `No se puede aprobar: el plan ${problem}. Pide cambios o rechaza.`,
        ),
    createElement(
      "div",
      { className: "notebook-actions" },
      button(true, "Aprobar el plan", {
        disabled: busy || problem !== null,
        onClick: () => onDecide({ kind: "approve" }),
      }),
      button(false, "Pedir cambios", {
        disabled: busy,
        onClick: () => dispatch({ type: "open", kind: "request_changes" }),
      }),
      button(false, "Rechazar el plan", {
        disabled: busy,
        onClick: () => dispatch({ type: "open", kind: "reject" }),
      }),
    ),
  );
}

/** La vista de un plan en revisión: portada y cuatro secciones, la última con la decisión. */
export function PlanNotebook({
  task,
  plan,
  busy = false,
  onDecide,
}: {
  task: TaskCover;
  plan: PlanData;
  busy?: boolean;
  onDecide: (decision: Decision) => void;
}): ReactNode {
  const { production, tests } = plan.estimatedLines;
  const approach = plan.approachErased ? "[borrado]" : plan.approach;
  const size = `producción ${production} de ${PLAN_LIMITS.maxProductionLines} · tests ${tests} · total ${production + tests} de ${PLAN_LIMITS.maxTotalLines}`;
  return createElement(
    "article",
    { className: "notebook" },
    createElement(Cover, { task, plan }),
    createElement(
      Section,
      { n: 0, title: "El enfoque" },
      createElement(
        "p",
        { className: plan.approachErased ? "notebook-approach muted" : "notebook-approach" },
        approach,
      ),
    ),
    createElement(Section, { n: 1, title: "Los ficheros" }, createElement(Files, { plan })),
    createElement(
      Section,
      { n: 2, title: "El tamaño" },
      createElement("p", { className: "notebook-size" }, size),
    ),
    createElement(
      Section,
      { n: 3, title: "La decisión" },
      createElement(Decide, { plan, busy, onDecide }),
    ),
  );
}
