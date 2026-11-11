import { createElement, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { MesaCards } from "./MesaCards.ts";
import { glyph } from "./MesaFlowNode.ts";
import { MesaMap } from "./MesaMap.ts";
import type { MesaState } from "./mesa.ts";
import { MesaTasksContext } from "./mesaContext.ts";
import { taskCards } from "./mesaTasks.ts";
import { PanelContext, PanelEdge, usePanel } from "./PanelEdge.ts";
import type { Panel } from "./panelState.ts";
import type { TaskRow } from "./TaskList.ts";

// La mesa en vivo (ADR-010 §3, pantalla 5 del diseño): la cabecera, el mapa sobre React Flow
// (MesaMap.ts) y, al lado, lo último que ha pasado por togi: una tarjeta por tarea (MesaCards.ts) y,
// plegado, el registro entero. Todo el texto es del vocabulario cerrado de la cabecera o el título de
// la tarea, pintado como nodo de texto. Sin JSX.

/** El mapa de la mesa: togi en el centro, tú arriba y las plazas a los lados. Se puede mover. */
export const MesaView = MesaMap;

interface Props {
  state: MesaState;
  waiting: number;
  /** Los títulos de las tareas, por número: van encima de cada plaza. */
  titles?: ReadonlyMap<number, string>;
  /** Las tareas, para las tarjetas del lateral. */
  tasks?: readonly TaskRow[];
  /** «Abrir cuaderno →»: lleva al cuaderno de la tarea, fuera de la mesa. */
  onOpen?: (task: number) => void;
  /** El panel al abrir la mesa; si no llega, el que se guardó. Para los tests. */
  panel?: Panel;
}

/** Cada cuánto se rehace «hace 12 s». */
const TICK_MS = 5000;

/** La vista entera: la cabecera, el mapa y lo último que ha pasado por togi. */
export function MesaScreen({ state, waiting, titles, panel: initial, ...props }: Props): ReactNode {
  // Las tareas llegan de la app por contexto (App.tsx); las props mandan, para los tests.
  const given = useContext(MesaTasksContext);
  const tasks = props.tasks ?? given.tasks;
  const onOpen = props.onOpen ?? given.onOpen;
  const [open, setOpen] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, []);
  const cards = useMemo(() => taskCards(tasks, state), [tasks, state]);
  const log = [...(state.log ?? [])].reverse();
  const toggle = (task: number) => setOpen((prev) => (prev === task ? null : task));
  // El panel lo lleva la app (su control va en la barra de título); sin proveedor, el de la mesa.
  const lifted = useContext(PanelContext);
  const local = usePanel(initial, lifted === null);
  const [panel, setPanel] = lifted ?? local;
  return createElement(
    "section",
    {
      className: "mesa-screen",
      "aria-label": "Mesa en vivo",
      style: { ["--mesa-panel-width" as string]: `${panel.width}px` },
    },
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
      createElement(MesaMap, {
        state,
        waiting,
        ...(titles ? { titles } : {}),
        selected: open,
        onSelect: (task: number) => setOpen(task),
      }),
    ),
    createElement(PanelEdge, { panel, onChange: setPanel }),
    createElement(
      "aside",
      {
        className: "mesa-log",
        "aria-label": "Lo último que ha pasado por togi",
        hidden: !panel.open,
      },
      createElement("h2", null, "Lo último que ha pasado por togi"),
      tasks.length > 0 &&
        createElement(MesaCards, {
          cards,
          open,
          onToggle: toggle,
          onOpen,
          now,
        }),
      log.length === 0
        ? createElement("p", { className: "muted" }, "Todavía no ha pasado nada por togi.")
        : createElement(
            "details",
            { className: "mesa-log-all" },
            createElement("summary", null, `Registro completo · ${log.length}`),
            createElement(
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
