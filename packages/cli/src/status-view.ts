import type { TaskState } from "@togi/core";
import { oneLine, relativeTime, say } from "./format.ts";
import type { Output } from "./output.ts";

/** Máximo que pide `togi status`; la API no devuelve más (200). */
export const PAGE = 200;
const WIDTH = 80;

export interface StatusTask {
  number: number;
  title: string | null;
  titleErased: boolean;
  state: TaskState;
  risk: string;
  hasCriteria: boolean;
  updatedAt: string;
}

const PENDING: TaskState[] = ["draft", "plan_review", "review", "failed"];
const ACTIVE: TaskState[] = ["planning", "building", "verifying"];
const CLOSED: TaskState[] = ["merged", "rejected"];

interface Cell {
  text: string;
  paint?: (s: string) => string;
}

const pad = (c: Cell, width: number): string => {
  const painted = c.paint ? c.paint(c.text) : c.text;
  return painted + " ".repeat(Math.max(0, width - [...c.text].length));
};
const width = (cells: Cell[]): number => Math.max(0, ...cells.map((c) => [...c.text].length));

function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

/** Texto del resumen final: recuento (o aviso de truncado) y ocultas, nunca un total falso. */
function footer(shown: number, tasks: StatusTask[], showClosed: boolean): string {
  const hidden = showClosed ? [] : tasks.filter((t) => CLOSED.includes(t.state));
  const truncated = tasks.length >= PAGE;
  const count = truncated
    ? say("status_truncated", { n: PAGE })
    : shown === 0
      ? say("status_none_open")
      : say("status_tasks", { n: shown });
  if (hidden.length === 0) return count;
  const parts = (["rejected", "merged"] as const)
    .map((state) => ({ state, n: hidden.filter((t) => t.state === state).length }))
    .filter((p) => p.n > 0)
    .map((p) => say(`status_${p.state}`, { n: p.n }));
  return `${count} · ${say("status_hidden", { n: hidden.length, detail: parts.join(" y ") })}`;
}

/**
 * Salida de `togi status`. `now` se inyecta para que la fecha relativa sea comprobable.
 * Con `all` o un `--state` explícito se muestran también las cerradas; si no, se ocultan y se cuentan.
 */
export function renderStatus(
  tasks: StatusTask[],
  opts: { state?: string; all: boolean },
  out: Output,
  now: Date,
): string {
  if (tasks.length === 0) {
    return `${opts.state === undefined ? say("status_none") : say("status_none_in_state", { state: opts.state })}\n`;
  }
  const showClosed = opts.all || opts.state !== undefined;
  const groups = [
    { title: say("group_pending"), states: PENDING, tone: "attention" as const },
    { title: say("group_active"), states: ACTIVE, tone: "muted" as const },
    ...(showClosed ? [{ title: say("group_closed"), states: CLOSED, tone: "muted" as const }] : []),
  ]
    .map((g) => ({ ...g, rows: tasks.filter((t) => g.states.includes(t.state)) }))
    .filter((g) => g.rows.length > 0);
  const rows = groups.flatMap((g) => g.rows);
  const tail = (t: StatusTask): Cell =>
    t.hasCriteria
      ? { text: relativeTime(t.updatedAt, now), paint: (s) => out.paint("muted", s) }
      : { text: say("missing_criteria_short"), paint: (s) => out.paint("attention", s) };
  const numberW = width(rows.map((t) => ({ text: `#${t.number}` })));
  const stateW = width(rows.map((t) => ({ text: t.state })));
  const riskW = width(rows.map((t) => ({ text: say(`risk_${t.risk}`) })));
  const tailW = width(rows.map(tail));
  // 2 de sangría + 4 separadores de 2 espacios entre las 5 columnas.
  const titleMax = WIDTH - 2 - numberW - stateW - riskW - tailW - 8;
  const title = (t: StatusTask): Cell =>
    t.titleErased || t.title === null
      ? { text: say("text_erased"), paint: (s) => out.paint("muted", s) }
      : { text: truncate(oneLine(t.title), titleMax) };
  const titleW = width(rows.map(title));
  const blocks = groups.map((g) => {
    const lines = g.rows.map((t) =>
      [
        pad({ text: `#${t.number}`, paint: (s) => out.paint("accent", s) }, numberW),
        pad(title(t), titleW),
        pad({ text: t.state, paint: (s) => out.paint(g.tone, s) }, stateW),
        pad({ text: say(`risk_${t.risk}`) }, riskW),
        tail(t).paint?.(tail(t).text),
      ]
        .join("  ")
        .replace(/^/, "  "),
    );
    return [g.title, ...lines].join("\n");
  });
  return `${[...blocks, footer(rows.length, tasks, showClosed)].join("\n\n")}\n`;
}
