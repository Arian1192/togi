import { buildProjects } from "./projects.ts";
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
      // El grupo pending con lo que te espera primero, igual que en la columna.
      return buildProjects(tasks, false).pending;
    case "project":
      return tasks.filter((t) => t.repo === view.repo);
    case "task":
      return tasks.filter((t) => t.number === view.number);
  }
}

/** ⌘\ pliega y despliega la columna. Cualquier otro modificador, o tecla, no lo dispara. */
export function isToggleShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return e.key === "\\" && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
}

/** El conjunto de proyectos plegados con `repo` cambiado de estado; no modifica el anterior. */
export function toggled(closed: ReadonlySet<string>, repo: string): Set<string> {
  const next = new Set(closed);
  if (!next.delete(repo)) next.add(repo);
  return next;
}
