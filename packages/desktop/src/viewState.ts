import { attentionGroup } from "@togi/core";
import type { TaskRow } from "./TaskList.ts";

// Qué muestra la app y qué proyectos están plegados. Sin DOM: App lo guarda y la columna lo pinta.

export type View =
  | { kind: "pending" }
  | { kind: "project"; repo: string }
  | { kind: "task"; number: number };

export const PENDING: View = { kind: "pending" };

/** Las tareas de la vista. Una selección que ya no existe (la lista se recargó) no muestra nada. */
export function tasksFor(view: View, tasks: TaskRow[]): TaskRow[] {
  switch (view.kind) {
    case "pending":
      return tasks.filter((t) => attentionGroup(t.state) === "pending");
    case "project":
      return tasks.filter((t) => t.repo === view.repo);
    case "task":
      return tasks.filter((t) => t.number === view.number);
  }
}

/** El conjunto de proyectos plegados con `repo` cambiado de estado; no modifica el anterior. */
export function toggled(closed: ReadonlySet<string>, repo: string): Set<string> {
  const next = new Set(closed);
  if (!next.delete(repo)) next.add(repo);
  return next;
}
