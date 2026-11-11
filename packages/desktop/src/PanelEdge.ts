import { createElement, useEffect, useState } from "react";
import * as P from "./panelState.ts";

// El borde del panel derecho de la mesa y su estado (ADR-010 §3, «Panel derecho»). Sin JSX.

const STEP = 16; // Lo que crece o encoge el panel con ← y → sobre su borde.

const store = () => (typeof localStorage === "undefined" ? undefined : localStorage);

/** El panel derecho: si está abierto, su ancho, ⌘⌥\ y lo que se guarda al cambiar. */
export function usePanel(initial: P.Panel | undefined) {
  const [panel, setPanel] = useState<P.Panel>(() => initial ?? P.readPanel(store()));
  useEffect(() => P.writePanel(store(), panel), [panel]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!P.isPanelShortcut(e)) return;
      e.preventDefault();
      setPanel((prev) => ({ ...prev, open: !prev.open }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [panel, setPanel] as const;
}

/**
 * El borde del panel: se arrastra para cambiar el ancho (o ← y → con el foco) y su botón lo pliega y
 * lo despliega. Plegado, el borde se queda para volver a abrirlo.
 */
type EdgeProps = { panel: P.Panel; onChange: (next: P.Panel) => void };
export function PanelEdge({ panel, onChange }: EdgeProps) {
  const resize = (width: number) => onChange({ ...panel, width });
  const onPointerDown = (e: { clientX: number; currentTarget: HTMLElement; pointerId: number }) => {
    const startX = e.clientX;
    const startWidth = panel.width;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => resize(P.dragged(startWidth, startX, m.clientX));
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };
  const onKeyDown = (e: { key: string; preventDefault: () => void }) => {
    const delta = e.key === "ArrowLeft" ? STEP : e.key === "ArrowRight" ? -STEP : 0;
    if (delta === 0) return;
    e.preventDefault();
    resize(P.clampWidth(panel.width + delta));
  };
  const label = panel.open ? "Plegar el panel (⌘⌥\\)" : "Desplegar el panel (⌘⌥\\)";
  return createElement(
    "div",
    { className: panel.open ? "mesa-edge" : "mesa-edge is-closed" },
    panel.open &&
      createElement("div", {
        className: "mesa-edge-grip",
        role: "separator",
        "aria-orientation": "vertical",
        "aria-label": "Ancho del panel",
        "aria-valuenow": panel.width,
        "aria-valuemin": P.PANEL_MIN,
        "aria-valuemax": P.PANEL_MAX,
        tabIndex: 0,
        onPointerDown,
        onKeyDown,
      }),
    createElement(
      "button",
      {
        type: "button",
        className: "mesa-edge-toggle",
        "aria-label": label,
        "aria-expanded": panel.open,
        onClick: () => onChange({ ...panel, open: !panel.open }),
      },
      panel.open ? "›" : "‹",
    ),
  );
}
