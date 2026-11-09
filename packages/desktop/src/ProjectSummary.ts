import { createElement, type ReactNode } from "react";
import { type Project, summaryOf } from "./projects.ts";
import { TaskRows } from "./TaskList.ts";

// El resumen de un proyecto (ADR-010 §2): sus tareas por quién tiene que actuar y cuántas hay
// cerradas. Sin JSX a propósito: los tests de la app corren con `node --test`.

const SECTIONS = [
  { key: "waiting", kanji: "一", title: "Pendiente de ti" },
  { key: "active", kanji: "二", title: "En curso" },
  { key: "drafts", kanji: "三", title: "Borradores" },
] as const;

/** «2 cerradas», «1 cerrada»; con «+» si la lista llegó truncada y puede haber más. */
export const closedLabel = (n: number, partial: boolean): string =>
  `${n}${partial ? "+" : ""} ${n === 1 && !partial ? "cerrada" : "cerradas"}`;

export function ProjectSummary({
  project,
  partial,
}: {
  project: Project;
  partial: boolean;
}): ReactNode {
  const summary = summaryOf(project);
  return createElement(
    "div",
    { className: "view" },
    createElement("h1", { className: "view-title" }, project.name),
    createElement(
      "p",
      { className: "view-meta" },
      createElement("code", { className: "ident" }, project.repo),
      ` · ${project.tasks.length} tareas`,
    ),
    SECTIONS.filter(({ key }) => summary[key].length > 0).map(({ key, kanji, title }) =>
      createElement(
        "section",
        { key, className: "task-group" },
        createElement(
          "h2",
          null,
          createElement("span", { className: "kanji" }, kanji),
          ` ${title} · ${summary[key].length}`,
        ),
        createElement(TaskRows, { tasks: summary[key] }),
      ),
    ),
    summary.closed > 0 &&
      createElement("p", { className: "muted" }, closedLabel(summary.closed, partial)),
  );
}
