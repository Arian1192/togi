import { createElement, type ReactNode } from "react";
import { MesaMap } from "./MesaMap.ts";
import type { MesaState } from "./mesa.ts";

// La mesa en vivo (ADR-010 §3): el mapa, sobre React Flow (MesaMap.ts), y lo último que ha pasado por
// togi. Todo el texto es del vocabulario cerrado de la cabecera, pintado como nodo de texto. Sin JSX.

/** El mapa de la mesa: togi en el centro, tú arriba y las plazas a los lados. Se puede mover. */
export const MesaView = MesaMap;

/** La vista entera: el mapa y, al lado, lo último que ha pasado por togi, más reciente primero. */
export function MesaScreen({ state, waiting }: { state: MesaState; waiting: number }): ReactNode {
  const log = [...(state.log ?? [])].reverse();
  return createElement(
    "section",
    { className: "mesa-screen", "aria-label": "Mesa en vivo" },
    createElement(
      "header",
      { className: "mesa-head" },
      createElement("h1", null, "Mesa en vivo"),
      createElement("span", { className: "mesa-live" }, `en vivo · seq ${state.lastSeq}`),
    ),
    createElement(
      "div",
      { className: "mesa-body" },
      createElement(MesaMap, { state, waiting }),
      createElement(
        "aside",
        { className: "mesa-log", "aria-label": "Lo último que ha pasado por togi" },
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
    ),
  );
}
