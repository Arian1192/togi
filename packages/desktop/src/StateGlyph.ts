import { STATE_BRAND, type TaskState } from "@togi/core";
import { createElement, type ReactNode } from "react";

// Los glifos de estado del manual de marca dibujados como SVG, porque ninguna de las tres fuentes de
// la marca trae ◐ ◑ ni ✕ (y M PLUS 1 Code, la de los estados, tampoco ◆ ni ●). Trazo de 1,5 px,
// esquinas rectas y `currentColor`: toman el color del texto, que pone el color del estado.
// El glifo de cada estado sale de `STATE_BRAND`, la misma tabla de la que la CLI imprime el carácter.

type Attrs = Record<string, string | number>;
export type Shape = [tag: "circle" | "path" | "polygon", attrs: Attrs];

const R = 5.25; // con el trazo, el círculo llena 12 de las 16 unidades
const ring: Shape = ["circle", { cx: 8, cy: 8, r: R }];
const FILL = { fill: "currentColor" };
// Medio círculo relleno de arriba a abajo; sweep 0 pasa por la izquierda y 1 por la derecha.
const half = (sweep: 0 | 1): Shape => [
  "path",
  { d: `M8 2.75A${R} ${R} 0 0 ${sweep} 8 13.25Z`, ...FILL },
];

/** Los siete dibujos, por el carácter de la tabla de estados. */
export const GLYPHS: Record<string, Shape[]> = {
  "○": [ring],
  "◐": [ring, half(0)],
  "◑": [ring, half(1)],
  "◆": [["polygon", { points: "8,3 13,8 8,13 3,8", ...FILL }]],
  "●": [["circle", { cx: 8, cy: 8, r: R, ...FILL }]],
  "✕": [["path", { d: "M4 4L12 12M12 4L4 12" }]],
  "—": [["path", { d: "M3.5 8H12.5" }]],
};

/**
 * El glifo de un estado como SVG en línea, del tamaño del texto (1em). Decorativo: el estado va
 * escrito al lado. Un estado que esta versión no conoce (un daemon más nuevo) no dibuja nada.
 */
export function StateGlyph({ state }: { state: TaskState }): ReactNode {
  const shapes = GLYPHS[STATE_BRAND[state]?.glyph ?? ""];
  if (shapes === undefined) return null;
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
      strokeLinecap: "butt",
      strokeLinejoin: "miter",
      "aria-hidden": true,
    },
    ...shapes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
  );
}
