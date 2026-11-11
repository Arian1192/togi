import { createElement, type ReactNode, useEffect, useState } from "react";
import { ActivityTimeline } from "./ActivityTimeline.ts";
import type { ActivityResult } from "./activityApi.ts";
import type { LogEntry } from "./mesa.ts";

// La Actividad de la tarea elegida en el panel derecho (ADR-010 §3): el chip «#n ✕» para volver a
// todas, el cuaderno y la línea de tiempo (ActivityTimeline.ts). Sin JSX.

export type ReadActivity = (task: number) => Promise<ActivityResult>;

/** Lo último que la mesa sabe de la tarea: el seq de su última cabecera, 0 si no hay ninguna. */
export function activityVersion(log: readonly LogEntry[] | undefined, task: number): number {
  let seq = 0;
  for (const e of log ?? []) if (e.number === task && e.seq > seq) seq = e.seq;
  return seq;
}

/** Numera las lecturas: una respuesta vale solo si es más nueva que la última enseñada. */
export function newerOnly() {
  let asked = 0;
  let shown = 0;
  return {
    ask: () => ++asked,
    take: (id: number) => {
      if (id <= shown) return false;
      shown = id;
      return true;
    },
  };
}

interface Props {
  task: number;
  now: number;
  onClear: () => void;
  onOpen: (task: number) => void;
}

/** La vista: el chip, el cuaderno y la actividad leída (`null` mientras se lee). */
export function ActivityPanel({
  task,
  result,
  now,
  onClear,
  onOpen,
}: Props & { result: ActivityResult | null }): ReactNode {
  return [
    createElement(
      "div",
      { key: "head", className: "mc-head" },
      createElement(
        "button",
        {
          type: "button",
          className: "mc-back",
          "aria-label": "Volver a todas las tareas",
          onClick: onClear,
        },
        `#${task} ✕`,
      ),
      createElement(
        "button",
        { type: "button", className: "mesa-card-open", onClick: () => onOpen(task) },
        "Abrir cuaderno →",
      ),
    ),
    createElement(ActivityTimeline, { key: "feed", result, now }),
  ];
}

/**
 * Lee la actividad al montarse y la relee con cada `version`. La mesa la monta con la tarea como
 * clave: al cambiar de tarea empieza vacía y nunca enseña la de otra como si fuera la actual.
 */
export function TaskActivity({
  version,
  read,
  ...props
}: Props & { version: number; read: ReadActivity }): ReactNode {
  const { task } = props;
  const [result, setResult] = useState<ActivityResult | null>(null);
  const [order] = useState(newerOnly);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` solo dispara la relectura.
  useEffect(() => {
    const id = order.ask();
    void read(task).then((r) => {
      if (order.take(id)) setResult(r);
    });
  }, [task, version, read]);
  return createElement(ActivityPanel, { ...props, result });
}
