import { EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { createElement, type ReactNode } from "react";
import type { MesaEdge } from "./mesaFlow.ts";

// Cómo se pinta cada arista de la mesa en React Flow: una curva hasta togi; mientras la sesión sigue,
// un punto que la recorre sin parar (CSS, `.mesa-dot`); el último mensaje, que la recorre una vez
// (`.mesa-pulse`, su `key` es su seq, así que uno nuevo vuelve a animarse), y su etiqueta. Sin JSX.

export function MesaFlowEdge(props: EdgeProps<MesaEdge>): ReactNode {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [toTogi, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  // El mismo camino al revés, para lo que va de togi a la plaza.
  const [toSeat] = getBezierPath({
    sourceX: targetX,
    sourceY: targetY,
    sourcePosition: targetPosition,
    targetX: sourceX,
    targetY: sourceY,
    targetPosition: sourcePosition,
  });
  const way = (toward: "togi" | "seat") => (toward === "togi" ? toTogi : toSeat);
  const p = data?.pulse;
  return createElement(
    "g",
    { className: `mesa-link ${data?.tone ?? ""}` },
    createElement("path", { className: "mesa-edge", d: toTogi }),
    data?.flow &&
      createElement("path", {
        className: `mesa-dot to-${data.flow}`,
        pathLength: 1,
        d: way(data.flow),
      }),
    p &&
      createElement("path", {
        key: `pulse-${p.seq}`,
        className: `mesa-pulse to-${p.toward}`,
        pathLength: 1,
        d: way(p.toward),
        "data-event": p.name,
      }),
    data?.chip &&
      createElement(
        EdgeLabelRenderer,
        null,
        createElement(
          "span",
          {
            className: `mesa-chip ${data.tone} nodrag nopan`,
            style: { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` },
          },
          data.chip,
        ),
      ),
  );
}
