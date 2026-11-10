import { createElement, type ReactNode } from "react";
import { glyph } from "./MesaFlowNode.ts";
import { MesaMap } from "./MesaMap.ts";
import type { MesaState } from "./mesa.ts";

// La mesa en vivo (ADR-010 §3, pantalla 5 del diseño): la cabecera, el mapa sobre React Flow
// (MesaMap.ts) y, al lado, lo último que ha pasado por togi. Todo el texto es del vocabulario cerrado
// de la cabecera o el título de la tarea, pintado como nodo de texto. Sin JSX.

/** El mapa de la mesa: togi en el centro, tú arriba y las plazas a los lados. Se puede mover. */
export const MesaView = MesaMap;

interface Props {
  state: MesaState;
  waiting: number;
  /** Los títulos de las tareas, por número: van encima de cada plaza. */
  titles?: ReadonlyMap<number, string>;
}

/** La vista entera: la cabecera, el mapa y lo último que ha pasado por togi, más reciente primero. */
export function MesaScreen({ state, waiting, titles }: Props): ReactNode {
  const log = [...(state.log ?? [])].reverse();
  return createElement(
    "section",
    { className: "mesa-screen", "aria-label": "Mesa en vivo" },
    createElement(
      "div",
      { className: "mesa-main" },
      createElement(
        "header",
        { className: "mesa-head" },
        createElement("h1", null, "Mesa en vivo"),
        createElement(
          "span",
          { className: "mesa-live" },
          glyph("◐"),
          `en vivo · seq ${state.lastSeq}`,
        ),
      ),
      createElement(MesaMap, { state, waiting, ...(titles ? { titles } : {}) }),
    ),
    createElement(
      "aside",
      { className: "mesa-log", "aria-label": "Lo último que ha pasado por togi" },
      createElement("h2", null, "Lo último que ha pasado por togi"),
      log.length === 0
        ? createElement("p", { className: "muted" }, "Todavía no ha pasado nada por togi.")
        : createElement(
            "ol",
            null,
            log.map((e) =>
              createElement(
                "li",
                { key: e.seq },
                createElement("code", { className: "ident" }, e.name),
                createElement(
                  "span",
                  { className: "mesa-log-meta" },
                  `${e.who} · #${e.number} · ${e.at.slice(11, 19)} · seq ${e.seq}`,
                ),
              ),
            ),
          ),
    ),
  );
}
