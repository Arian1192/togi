import { Handle, type NodeProps, Position } from "@xyflow/react";
import { createElement, type ReactNode } from "react";
import type { Glyph, MesaNode } from "./mesaFlow.ts";
import { GLYPHS } from "./StateGlyph.ts";

// Cómo se pinta cada nodo de la mesa en React Flow (pantalla 5 del diseño). Todo el texto es del
// vocabulario cerrado de la cabecera o el título de la tarea, pintado como nodo de texto. Sin JSX.

const MONOGRAM =
  "M25 12 L35 6 L35 20 L49 20 L49 29 L35 29 L35 42 Q35 48 41 48 L49 48 L49 58 L41 58 Q25 58 25 42 L25 29 L15 29 L15 20 L25 20 Z";

/** Un glifo de la tabla de estados como SVG en línea (manual de marca: nunca como carácter). */
export function glyph(char: Glyph): ReactNode {
  return createElement(
    "svg",
    {
      className: "glyph",
      viewBox: "0 0 16 16",
      width: "1em",
      height: "1em",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.5,
      "aria-hidden": true,
    },
    ...(GLYPHS[char] ?? []).map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
  );
}

// El asidero marca dónde se engancha una arista; no se puede usar para unir nada.
const handle = (id: string, type: "source" | "target", position: Position) =>
  createElement(Handle, {
    key: id,
    id,
    type,
    position,
    className: "mesa-handle",
    isConnectable: false,
  });

export function MesaFlowNode({ data }: NodeProps<MesaNode>): ReactNode {
  const note = createElement(
    "span",
    { className: "mesa-note" },
    data.glyph && glyph(data.glyph),
    data.note,
  );
  if (data.tone === "is-togi") {
    return createElement(
      "div",
      { className: "mesa-node is-togi" },
      createElement(
        "svg",
        { viewBox: "0 0 64 64", width: 30, height: 30, "aria-hidden": true },
        createElement("path", { fill: "currentColor", d: MONOGRAM }),
      ),
      createElement("span", { className: "mesa-title" }, data.title),
      note,
      handle("left", "target", Position.Left),
      handle("right", "target", Position.Right),
      handle("top", "target", Position.Top),
    );
  }
  if (data.tone === "is-you") {
    return createElement(
      "div",
      { className: data.waiting ? "mesa-node is-you is-waiting" : "mesa-node is-you" },
      createElement("span", { className: "mesa-title" }, data.title),
      note,
      handle("bottom", "source", Position.Bottom),
    );
  }
  // Una plaza: su tarea encima y la tarjeta debajo, con un asidero a cada lado.
  return createElement(
    "div",
    { className: "mesa-seat" },
    createElement("span", { className: "mesa-label" }, data.label),
    createElement(
      "div",
      { className: `mesa-node ${data.tone}` },
      createElement(
        "div",
        { className: "mesa-row" },
        createElement("span", { className: "mesa-title" }, data.title),
        data.meta && createElement("span", { className: "mesa-meta" }, data.meta),
      ),
      note,
      handle("left", "source", Position.Left),
      handle("right", "source", Position.Right),
    ),
  );
}
