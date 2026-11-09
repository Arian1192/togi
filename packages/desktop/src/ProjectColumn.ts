import { stateColor } from "@togi/core";
import { createElement, Fragment, type ReactNode, useEffect, useState } from "react";
import { closedLabel } from "./ProjectSummary.ts";
import { openTasks, type Project, type Projects } from "./projects.ts";
import { StateGlyph } from "./StateGlyph.ts";
import type { View } from "./viewState.ts";

// La columna de proyectos (ADR-010 §2): «Pendiente de ti», y cada proyecto con sus tareas.
// Sin JSX a propósito: los tests de la app corren con `node --test`, que no transforma .tsx.

interface Props {
  /** `null`: no hay lista (el daemon no responde); la columna solo muestra la cabecera y el pie. */
  data: Projects | null;
  /** Arriba: la marca. */
  head?: ReactNode;
  /** Abajo: el estado del daemon. */
  foot?: ReactNode;
  view: View;
  closed: ReadonlySet<string>;
  onView: (view: View) => void;
  onToggle: (repo: string) => void;
  /** Plegada a un riel con la inicial de cada proyecto. */
  collapsed?: boolean;
  /** Pliega o despliega la columna; sin él no hay botón. */
  onCollapse?: () => void;
  /** Lleva ya plegada el tiempo de la transición (`useSettled`); sin él, se supone que sí. */
  settled?: boolean;
}

const SHORTCUT = "⌘\\";

const on = (selected: boolean) => (selected ? "true" : undefined);

/** Lo que te espera y lo que está en curso, con el glifo de su estado; «+» si la lista está truncada. */
function counts(project: Project, partial: boolean): ReactNode {
  const { waiting, active } = project.counts;
  return createElement(
    "span",
    { className: "col-counts" },
    waiting > 0 &&
      createElement("span", { key: "w", className: "tone-human" }, [
        createElement(StateGlyph, { key: "g", state: "plan_review" }),
        waiting,
      ]),
    active > 0 &&
      createElement("span", { key: "a", className: "tone-agent" }, [
        createElement(StateGlyph, { key: "g", state: "building" }),
        active,
      ]),
    partial && createElement("span", { key: "p", className: "col-partial" }, "+"),
  );
}

function projectBlock(project: Project, props: Props & { data: Projects }): ReactNode {
  const { view, closed, onView, onToggle, data } = props;
  const open = !closed.has(project.repo);
  const selected = view.kind === "project" && view.repo === project.repo;
  return createElement(
    "div",
    { key: project.repo, className: "col-project" },
    createElement(
      "div",
      { className: "col-row" },
      createElement(
        "button",
        {
          type: "button",
          className: "col-toggle",
          "aria-expanded": open,
          "aria-label": `${open ? "Plegar" : "Desplegar"} ${project.name}`,
          onClick: () => onToggle(project.repo),
        },
        createElement(
          "svg",
          { viewBox: "0 0 16 16", width: "1em", height: "1em", "aria-hidden": true },
          createElement("path", {
            d: open ? "M4 6l4 4 4-4" : "M6 4l4 4-4 4",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.5,
          }),
        ),
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "col-name",
          "aria-current": on(selected),
          onClick: () => onView({ kind: "project", repo: project.repo }),
        },
        createElement("span", null, project.name),
        counts(project, data.partial),
      ),
    ),
    open &&
      openTasks(project).length === 0 &&
      project.counts.closed > 0 &&
      createElement(
        "p",
        { className: "col-empty" },
        closedLabel(project.counts.closed, data.partial),
      ),
    open &&
      createElement(
        "ul",
        { className: "col-tasks" },
        openTasks(project).map((task) =>
          createElement(
            "li",
            { key: task.number },
            createElement(
              "button",
              {
                type: "button",
                className: "col-task",
                "aria-current": on(view.kind === "task" && view.number === task.number),
                onClick: () => onView({ kind: "task", number: task.number }),
              },
              // El color del estado (manual de marca), como en la lista del centro.
              createElement(
                "span",
                { className: `tone-${stateColor(task.state)}` },
                createElement(StateGlyph, { state: task.state }),
              ),
              createElement("code", { className: "ident" }, `#${task.number}`),
              createElement(
                "span",
                { className: "col-title" },
                task.titleErased || task.title === null ? "[borrado]" : task.title,
              ),
            ),
          ),
        ),
      ),
  );
}

// Iconos de Lucide (https://lucide.dev, licencia ISC): chevron-left y chevron-right, con el trazo de
// 1,5 px y las esquinas rectas de los glifos de la marca.
const CHEVRON = { left: "m15 18-6-6 6-6", right: "m9 18 6-6-6-6" } as const;

/**
 * El control que pliega o despliega la columna: una pestaña fina sobre la línea que la separa del
 * centro, con un `<` para plegar y un `>` para desplegar. Va fuera de la columna (que recorta su
 * contenido) y pegada a su borde, así que acompaña la transición del ancho.
 */
function collapseHandle({ collapsed, onCollapse }: Props): ReactNode {
  if (onCollapse === undefined) return null;
  const label = collapsed ? "Desplegar la columna" : "Plegar la columna";
  return createElement(
    "div",
    { key: "handle", className: "col-handle" },
    createElement(
      "button",
      {
        type: "button",
        className: "col-handle-btn",
        "aria-label": label,
        "aria-expanded": !collapsed,
        title: `${label} (${SHORTCUT})`,
        onClick: onCollapse,
      },
      createElement(
        "svg",
        { viewBox: "0 0 24 24", width: 12, height: 12, fill: "none", "aria-hidden": true },
        createElement("path", {
          d: collapsed ? CHEVRON.right : CHEVRON.left,
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "butt",
          strokeLinejoin: "miter",
        }),
      ),
    ),
  );
}

/** La columna plegada: «Pendiente de ti» y la inicial de cada proyecto, con su ◆ si algo te espera. */
function rail(props: Props & { data: Projects }): ReactNode {
  const { data, view, onView } = props;
  // Una insignia sobre la esquina de la letra, como una notificación: así la inicial queda sola y
  // centrada y todas se alinean. Decorativa: el nombre accesible del botón no cambia.
  const badge = (...content: ReactNode[]) =>
    createElement(
      "span",
      { key: "badge", className: "rail-badge tone-human", "aria-hidden": true },
      createElement("span", { className: "rail-badge-body" }, ...content),
    );
  const diamond = createElement(
    "span",
    { key: "d", className: "tone-human" },
    createElement(StateGlyph, { state: "plan_review" }),
  );
  return [
    createElement(
      "button",
      {
        key: "pending",
        type: "button",
        className: "rail-project",
        "aria-label": `Pendiente de ti, ${data.pending.length}`,
        title: "Pendiente de ti",
        "aria-current": on(view.kind === "pending"),
        onClick: () => onView({ kind: "pending" }),
      },
      diamond,
      badge(data.pending.length),
    ),
    ...data.projects.map((project) =>
      createElement(
        "button",
        {
          key: project.repo,
          type: "button",
          className: "rail-project",
          "aria-label": project.name,
          title:
            project.counts.waiting > 0
              ? `${project.name} · ${project.counts.waiting} esperan`
              : project.name,
          "aria-current": on(view.kind === "project" && view.repo === project.repo),
          onClick: () => onView({ kind: "project", repo: project.repo }),
        },
        createElement("span", { className: "rail-initial" }, project.name.charAt(0).toUpperCase()),
        project.counts.waiting > 0 &&
          badge(createElement(StateGlyph, { state: "plan_review" }), project.counts.waiting),
      ),
    ),
  ];
}

/** La duración de la transición del ancho; app.css usa los mismos 240ms. */
export const TRANSITION_MS = 240;

/**
 * Qué se pinta al plegar o desplegar. El ancho (`is-rail`) cambia en cuanto cambia `collapsed` y lo
 * anima el CSS; el contenido plegado (`is-rolled`, `showRail`) llega al final de la transición al
 * plegar y desaparece de inmediato al desplegar, así nada se deforma mientras el ancho cambia.
 */
export function railState(collapsed: boolean, settled: boolean) {
  return {
    className: ["project-col", collapsed && "is-rail", collapsed && settled && "is-rolled"]
      .filter(Boolean)
      .join(" "),
    showRail: collapsed && settled,
  };
}

/**
 * `true` cuando la columna lleva ya plegada el tiempo de la transición. Lo calcula `App` y lo pasa
 * como `settled`: así `ProjectColumn` sigue siendo una función pura, que los tests recorren sin React.
 */
export function useSettled(collapsed: boolean): boolean {
  const [settled, setSettled] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setSettled(false);
      return;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setSettled(true), reduced ? 0 : TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);
  return settled;
}

export function ProjectColumn(props: Props): ReactNode {
  const { data, view, onView, head, foot } = props;
  const target = props.collapsed === true && data !== null;
  // Sin `settled` el contenido plegado aparece a la vez que el ancho (sin transición de contenido).
  const { className, showRail } = railState(target, props.settled ?? true);
  const rolled = showRail;
  const nav = createElement(
    "nav",
    { className, "aria-label": "Proyectos" },
    head && createElement("div", { key: "head", className: "col-head" }, head),
    rolled &&
      data !== null &&
      createElement("div", { key: "rail", className: "col-scroll" }, rail({ ...props, data })),
    !rolled &&
      // Sin lista (el daemon no responde) no hay datos de tareas, pero sí cabecera y pie.
      createElement(
        "div",
        { key: "scroll", className: "col-scroll" },
        data &&
          createElement(
            "button",
            {
              type: "button",
              className: "col-pending",
              "aria-current": on(view.kind === "pending"),
              onClick: () => onView({ kind: "pending" }),
            },
            createElement("span", null, "Pendiente de ti"),
            createElement("span", { className: "col-counts tone-human" }, [
              createElement(StateGlyph, { key: "g", state: "plan_review" }),
              data.pending.length,
              data.partial && createElement("span", { key: "p", className: "col-partial" }, "+"),
            ]),
          ),
        data?.projects.map((project) => projectBlock(project, { ...props, data })),
      ),
    // El estado del daemon no cabe en 56 px: con el riel no se pinta (App despliega sola si cae).
    !rolled && foot && createElement("div", { key: "foot", className: "col-foot" }, foot),
  );
  return createElement(Fragment, null, nav, collapseHandle(props));
}
