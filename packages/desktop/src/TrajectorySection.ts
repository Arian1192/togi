import { createElement, type ReactNode } from "react";
import { type TrajectoryState, TrajectoryView } from "./Trajectory.ts";

// La trayectoria dentro del cuaderno (R6b): plegada hasta que se pide, porque leerla cuesta una
// llamada al daemon. Vista pura; `TrajectoryPane` lee y guarda el estado. Sin JSX a propósito.

interface Props {
  open: boolean;
  state: TrajectoryState;
  busy: boolean;
  onToggle: () => void;
  onMore: () => void;
  /** Vuelve a pedir desde el cursor: lo nuevo de una sesión en curso, o tras un fallo. */
  onRefresh: () => void;
}

export function TrajectorySection({
  open,
  state,
  busy,
  onToggle,
  onMore,
  onRefresh,
}: Props): ReactNode {
  // Una sesión en curso sigue creciendo: al llegar al final se puede pedir lo nuevo.
  const live = state.phase === "ready" && state.sessionState === "active" && !state.hasMore;
  const retry = state.phase === "empty" || state.phase === "error";
  const again = (label: string) =>
    createElement(
      "button",
      { type: "button", className: "btn btn-secondary", disabled: busy, onClick: onRefresh },
      label,
    );
  return createElement(
    "section",
    { className: "trajectory-section" },
    createElement(
      "button",
      {
        type: "button",
        className: "btn btn-secondary trajectory-toggle",
        "aria-expanded": open,
        "aria-controls": "trajectory-body",
        onClick: onToggle,
      },
      open ? "Ocultar la trayectoria" : "Ver la trayectoria",
    ),
    open &&
      createElement(
        "div",
        { id: "trajectory-body", className: "trajectory-body" },
        createElement(TrajectoryView, { state, busy, onMore }),
        live && again("Actualizar"),
        retry && again("Volver a leer"),
      ),
  );
}
