import { stateColor } from "@togi/core";
import { createElement, Fragment, type ReactNode } from "react";
import { closedLabel } from "./ProjectSummary.ts";
import { openTasks, type Project, type Projects } from "./projects.ts";
import { StateGlyph } from "./StateGlyph.ts";
import type { View } from "./viewState.ts";

// La columna de proyectos (ADR-010 §2): «Pendiente de ti», y cada proyecto con sus tareas.
// Sin JSX a propósito: los tests de la app corren con `node --test`, que no transforma .tsx.
//
// Plegada es la MISMA columna, como el Sidebar de shadcn: el contenido nunca cambia, solo el CSS lo
// recorta, lo desvanece o lo coloca (app.css, «Columna lateral: transiciones»). Cada botón lleva su
// etiqueta y su icono (la inicial del proyecto, el ◆ de «Pendiente de ti»); el icono solo se ve
// plegada. Cambiar de contenido a mitad de la animación es lo que hacía que «saltara».

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
  /** Plegada a un riel de 56 px con la inicial de cada proyecto. */
  collapsed?: boolean;
  /** Pliega o despliega la columna; sin él no hay asa. */
  onCollapse?: () => void;
}

const SHORTCUT = "⌘\\";

const on = (selected: boolean) => (selected ? "true" : undefined);

/** Una insignia sobre la esquina del icono, como una notificación. Decorativa: el botón ya lo dice. */
const badge = (...content: ReactNode[]) =>
  createElement(
    "span",
    { key: "badge", className: "rail-badge tone-human", "aria-hidden": true },
    createElement("span", { className: "rail-badge-body" }, ...content),
  );

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
  const { waiting } = project.counts;
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
          title: waiting > 0 ? `${project.name} · ${waiting} esperan` : project.name,
          "aria-current": on(selected),
          onClick: () => onView({ kind: "project", repo: project.repo }),
        },
        createElement("span", { className: "col-label" }, project.name),
        counts(project, data.partial),
        createElement(
          "span",
          { className: "col-initial", "aria-hidden": true },
          project.name.charAt(0).toUpperCase(),
        ),
        waiting > 0 &&
          badge(createElement(StateGlyph, { key: "g", state: "plan_review" }), waiting),
      ),
    ),
    open &&
      // Se pliegan en vertical (grid 1fr → 0fr): no se pueden recortar en horizontal, y así las
      // filas de debajo suben sin saltar.
      createElement(
        "div",
        { className: "col-tasks-wrap" },
        createElement(
          "div",
          { className: "col-tasks-inner" },
          openTasks(project).length === 0 &&
            project.counts.closed > 0 &&
            createElement(
              "p",
              { className: "col-empty" },
              closedLabel(project.counts.closed, data.partial),
            ),
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
function collapseHandle(collapsed: boolean, onCollapse: (() => void) | undefined): ReactNode {
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

export function ProjectColumn(props: Props): ReactNode {
  const { data, view, onView, head, foot } = props;
  // Sin lista no hay nada que plegar: la columna se queda como está para que se vea el estado.
  const collapsed = props.collapsed === true && data !== null;
  const nav = createElement(
    "nav",
    {
      className: collapsed ? "project-col is-collapsed" : "project-col",
      "aria-label": "Proyectos",
    },
    head && createElement("div", { key: "head", className: "col-head" }, head),
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
            title: "Pendiente de ti",
            "aria-current": on(view.kind === "pending"),
            onClick: () => onView({ kind: "pending" }),
          },
          createElement("span", { className: "col-label" }, "Pendiente de ti"),
          createElement("span", { className: "col-counts tone-human" }, [
            createElement(StateGlyph, { key: "g", state: "plan_review" }),
            data.pending.length,
            data.partial && createElement("span", { key: "p", className: "col-partial" }, "+"),
          ]),
          createElement(
            "span",
            { className: "col-initial tone-human", "aria-hidden": true },
            createElement(StateGlyph, { state: "plan_review" }),
          ),
          badge(data.pending.length),
        ),
      data?.projects.map((project) => projectBlock(project, { ...props, data })),
    ),
    foot && createElement("div", { key: "foot", className: "col-foot" }, foot),
  );
  return createElement(Fragment, null, nav, collapseHandle(collapsed, props.onCollapse));
}
