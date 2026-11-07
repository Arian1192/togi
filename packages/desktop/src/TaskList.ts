import {
  ATTENTION_GROUPS,
  type AttentionGroup,
  attentionGroup,
  STATE_BRAND,
  stateColor,
  type TaskState,
} from "@togi/core";
import { createElement, type ReactNode } from "react";
import { StateGlyph } from "./StateGlyph.ts";

// Los nombres de grupo son los de `togi status`; los dos sitios agrupan con `attentionGroup`.
// Sin JSX a propósito: los tests de la app corren con `node --test`, que no transforma .tsx.

/** Una fila tal y como la devuelve el comando `list_tasks`. */
export interface TaskRow {
  number: number;
  title: string | null;
  titleErased: boolean;
  state: TaskState;
  hasCriteria: boolean;
  updatedAt: string;
  version: number;
}

export const GROUP_LABEL: Record<AttentionGroup, string> = {
  pending: "Pendiente de ti",
  active: "En curso",
  closed: "Cerradas",
};

/** Las tareas por grupo, en el orden en que llegan. */
export function groupTasks(tasks: TaskRow[]): Record<AttentionGroup, TaskRow[]> {
  const groups: Record<AttentionGroup, TaskRow[]> = { pending: [], active: [], closed: [] };
  for (const task of tasks) groups[attentionGroup(task.state)].push(task);
  return groups;
}

function Row({ task }: { task: TaskRow }): ReactNode {
  // Un estado que esta versión no conoce (un daemon más nuevo) se pinta en gris.
  const tone = Object.hasOwn(STATE_BRAND, task.state) ? stateColor(task.state) : "ink-muted";
  const erased = task.titleErased || task.title === null;
  return createElement(
    "li",
    { className: "task-row" },
    createElement("span", { className: `task-state tone-${tone}` }, [
      createElement(StateGlyph, { key: "glyph", state: task.state }),
      createElement("span", { key: "name" }, task.state),
    ]),
    createElement("code", { className: "ident" }, `#${task.number}`),
    createElement(
      "span",
      { className: erased ? "task-title muted" : "task-title" },
      erased ? "[borrado]" : task.title,
    ),
    task.hasCriteria ? null : createElement("span", { className: "task-flag" }, "falta criterio"),
  );
}

function Group({ group, tasks }: { group: AttentionGroup; tasks: TaskRow[] }): ReactNode {
  const heading = `${GROUP_LABEL[group]} · ${tasks.length}`;
  const rows = createElement(
    "ul",
    { className: "task-rows" },
    tasks.map((task) => createElement(Row, { key: task.number, task })),
  );
  // Las cerradas van plegadas, como `togi status` las oculta; el recuento se ve igualmente.
  if (group === "closed") {
    return createElement(
      "details",
      { className: "task-group" },
      createElement("summary", null, heading),
      rows,
    );
  }
  return createElement(
    "section",
    { className: "task-group" },
    createElement("h2", null, heading),
    rows,
  );
}

/** Las tareas agrupadas por quién tiene que actuar. Los grupos vacíos no se pintan. */
export function TaskList({
  tasks,
  truncated,
}: {
  tasks: TaskRow[];
  truncated: boolean;
}): ReactNode {
  if (tasks.length === 0) return createElement("p", { className: "muted" }, "No hay tareas.");
  const groups = groupTasks(tasks);
  return createElement(
    "div",
    { className: "task-list" },
    ATTENTION_GROUPS.filter((g) => groups[g].length > 0).map((g) =>
      createElement(Group, { key: g, group: g, tasks: groups[g] }),
    ),
    truncated
      ? createElement(
          "p",
          { className: "muted" },
          "Se muestran las 200 más recientes: puede haber más.",
        )
      : null,
  );
}
