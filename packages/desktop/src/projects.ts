import { attentionGroup, STATE_BRAND, stateColor } from "@togi/core";
import type { TaskRow } from "./TaskList.ts";

// Un proyecto es un repo con tareas (ADR-010 §2). Sin DOM: la columna lo pinta con esto.

export interface ProjectCounts {
  /** Tareas que esperan a una persona: las de color `human` (plan_review, review y failed). */
  waiting: number;
  active: number;
  drafts: number;
  closed: number;
}

export interface Project {
  repo: string;
  name: string;
  tasks: TaskRow[];
  counts: ProjectCounts;
}

export interface Projects {
  projects: Project[];
  /** El grupo `pending` de todos los proyectos, con lo que te espera primero. */
  pending: TaskRow[];
  /** La lista llegó truncada: los contadores pueden quedarse cortos. */
  partial: boolean;
}

/** Un estado que esta versión no conoce (un daemon más nuevo) no espera a nadie. */
const isWaiting = (task: TaskRow): boolean =>
  Object.hasOwn(STATE_BRAND, task.state) && stateColor(task.state) === "human";

function count(tasks: TaskRow[]): ProjectCounts {
  const counts = { waiting: 0, active: 0, drafts: 0, closed: 0 };
  for (const task of tasks) {
    const group = attentionGroup(task.state);
    if (isWaiting(task)) counts.waiting += 1;
    if (group === "active") counts.active += 1;
    if (task.state === "draft") counts.drafts += 1;
    if (group === "closed") counts.closed += 1;
  }
  return counts;
}

/** Agrupa las tareas por repo. Primero los proyectos con algo que te espera; después, por nombre. */
export function buildProjects(tasks: TaskRow[], truncated: boolean): Projects {
  const byRepo = new Map<string, TaskRow[]>();
  for (const task of tasks) byRepo.set(task.repo, [...(byRepo.get(task.repo) ?? []), task]);
  const short = (repo: string): string => repo.slice(repo.indexOf("/") + 1);
  const taken = new Map<string, number>();
  for (const repo of byRepo.keys()) taken.set(short(repo), (taken.get(short(repo)) ?? 0) + 1);
  const projects = [...byRepo].map(([repo, list]) => ({
    repo,
    name: (taken.get(short(repo)) ?? 0) > 1 ? repo : short(repo),
    tasks: list,
    counts: count(list),
  }));
  projects.sort(
    (a, b) =>
      Number(b.counts.waiting > 0) - Number(a.counts.waiting > 0) || a.name.localeCompare(b.name),
  );
  const pending = tasks
    .filter((task) => attentionGroup(task.state) === "pending")
    .sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)) || a.number - b.number);
  return { projects, pending, partial: truncated };
}
