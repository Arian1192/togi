import {
  createContext,
  createElement,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useState,
} from "react";
import * as P from "./panelState.ts";

// El borde del panel derecho de la mesa y su estado (ADR-010 §3, «Panel derecho»). Sin JSX.

const STEP = 16; // Lo que crece o encoge el panel con ← y → sobre su borde.

const store = () => (typeof localStorage === "undefined" ? undefined : localStorage);

export type PanelState = readonly [P.Panel, Dispatch<SetStateAction<P.Panel>>];

/**
 * El panel que la app da a la mesa (App.tsx), para que el control de la barra de título y la mesa
 * compartan estado. Sin proveedor, la mesa lleva el suyo.
 */
export const PanelContext = createContext<PanelState | null>(null);

/**
 * El panel derecho: si está abierto, su ancho, ⌘⌥\ y lo que se guarda al cambiar. Inactivo, ni
 * escucha el atajo ni guarda: lo lleva otro.
 */
export function usePanel(initial: P.Panel | undefined, active = true): PanelState {
  const [panel, setPanel] = useState<P.Panel>(() => initial ?? P.readPanel(store()));
  useEffect(() => {
    if (active) P.writePanel(store(), panel);
  }, [panel, active]);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!P.isPanelShortcut(e)) return;
      e.preventDefault();
      setPanel((prev) => ({ ...prev, open: !prev.open }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  return [panel, setPanel] as const;
}

/**
 * El borde del panel abierto: se arrastra para cambiar el ancho (o ← y → con el foco). Lo pliega el
 * control de la barra de título; plegado, no queda borde y la mesa llega al de la ventana.
 */
type EdgeProps = { panel: P.Panel; onChange: (next: P.Panel) => void };
export function PanelEdge({ panel, onChange }: EdgeProps) {
  if (!panel.open) return null;
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
  return createElement(
    "div",
    { className: "mesa-edge" },
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
  );
}
