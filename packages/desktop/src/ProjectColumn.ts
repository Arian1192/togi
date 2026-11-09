import { stateColor } from "@togi/core";
import { createElement, type ReactNode } from "react";
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
}

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

export function ProjectColumn(props: Props): ReactNode {
  const { data, view, onView, head, foot } = props;
  return createElement(
    "nav",
    { className: "project-col", "aria-label": "Proyectos" },
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
    foot && createElement("div", { key: "foot", className: "col-foot" }, foot),
  );
}
