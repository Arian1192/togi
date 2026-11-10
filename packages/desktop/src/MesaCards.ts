import { createElement, type ReactNode } from "react";
import { glyph } from "./MesaFlowNode.ts";
import { eventLabel, type Mark, STEPS, since, type TaskCard, type TaskCards } from "./mesaTasks.ts";

// El lateral de la mesa por tarea (el modelo está en mesaTasks.ts): una tarjeta por tarea, con sus pasos y lo último que le ha pasado.
// Al pulsarla se despliega ahí mismo con su línea de tiempo; solo «Abrir cuaderno →» sale de la mesa.
// Todo el texto es del vocabulario cerrado de la cabecera o el título de la tarea. Sin JSX.

const MAX_WAITING = 3;

interface Props {
  cards: TaskCards;
  /** La tarjeta desplegada, si hay una. */
  open: number | null;
  onToggle: (task: number) => void;
  onOpen: (task: number) => void;
  /** La hora de ahora, para «hace 12 s». */
  now: number;
}

function Steps({ marks }: { marks: Mark[] }): ReactNode {
  return createElement(
    "ol",
    { className: "mesa-steps", "aria-label": "Pasos de la tarea" },
    STEPS.map((step, i) =>
      createElement(
        "li",
        { key: i, className: `mesa-step is-${marks[i]}` },
        createElement("span", { className: "mesa-step-dot", "aria-hidden": true }),
        createElement("span", { className: "mesa-step-name" }, step),
      ),
    ),
  );
}

// Quién manda a quién: todo pasa por togi.
const who = (name: string) => (name === "togi" ? "togi" : `${name} → togi`);

function Card({ card, open, onToggle, onOpen, now }: Omit<Props, "cards"> & { card: TaskCard }) {
  const isOpen = open === card.number;
  const last = card.events[0];
  const tone = `mesa-card is-${card.tone}${isOpen ? " is-open" : ""}`;
  return createElement(
    "li",
    { key: card.number, className: tone },
    createElement(
      "button",
      {
        type: "button",
        className: "mesa-card-head",
        "aria-expanded": isOpen,
        onClick: () => onToggle(card.number),
      },
      createElement("span", { className: "mesa-card-number" }, `#${card.number}`),
      createElement("span", { className: "mesa-card-title" }, card.title ?? "[borrado]"),
      createElement("span", { className: "mesa-card-chip" }, card.chip),
    ),
    card.marks && card.tone !== "quiet" && createElement(Steps, { marks: card.marks }),
    last &&
      !isOpen &&
      createElement(
        "p",
        { className: "mesa-card-last" },
        `${eventLabel(last.name)} · ${who(last.who)} · ${since(last.at, now)}`,
      ),
    isOpen &&
      createElement(
        "div",
        { className: "mesa-card-body" },
        card.events.length === 0
          ? createElement("p", { className: "muted" }, "Nada nuevo desde que abriste la mesa.")
          : createElement(
              "div",
              { className: "mesa-timeline" },
              card.events.map((e) =>
                createElement(
                  "div",
                  {
                    key: e.seq,
                    className: `mesa-event is-${e.who === "tú" ? "you" : e.who === "togi" ? "togi" : "agent"}`,
                  },
                  createElement("span", { className: "mesa-event-name" }, eventLabel(e.name)),
                  createElement("span", { className: "mesa-event-when" }, since(e.at, now)),
                  createElement(
                    "span",
                    { className: "mesa-event-who" },
                    `${who(e.who)} · seq ${e.seq}`,
                  ),
                ),
              ),
            ),
        createElement(
          "button",
          { type: "button", className: "mesa-card-open", onClick: () => onOpen(card.number) },
          "Abrir cuaderno →",
        ),
      ),
  );
}

/** Las tarjetas del lateral: lo que te espera arriba, luego lo que está en curso y lo reciente. */
export function MesaCards(props: Props): ReactNode {
  const { cards } = props;
  const shown = cards.waiting.slice(0, MAX_WAITING);
  // Lo que te espera y no cabe queda a mano en «Pendiente de ti» (⌘1), salvo la que tengas abierta.
  const extra = cards.waiting.slice(MAX_WAITING).filter((c) => c.number !== props.open);
  const pinned = cards.waiting.slice(MAX_WAITING).filter((c) => c.number === props.open);
  const all = [...shown, ...pinned, ...cards.active, ...cards.recent];
  if (all.length === 0 && extra.length === 0) {
    return createElement("p", { className: "muted" }, "Ninguna tarea en marcha.");
  }
  return createElement(
    "div",
    { className: "mesa-tasks" },
    createElement(
      "p",
      { className: "mesa-tasks-live" },
      glyph("◐"),
      `${cards.active.length} en curso`,
      cards.waiting.length > 0 &&
        createElement(
          "span",
          { className: "mesa-tasks-you" },
          ` · ${cards.waiting.length} te esperan`,
        ),
    ),
    createElement(
      "ol",
      { className: "mesa-cards" },
      all.map((card) => createElement(Card, { ...props, card, key: card.number })),
    ),
    extra.length > 0 &&
      createElement("p", { className: "mesa-tasks-more" }, `+${extra.length} más te esperan · ⌘1`),
  );
}
