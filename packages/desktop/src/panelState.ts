// El panel derecho de la mesa (ADR-010 §3, «Panel derecho»): acoplado, plegable con ⌘⌥\ y
// redimensionable. Recuerda si está abierto y su ancho entre aperturas de la app. Es estado de la
// interfaz, no del dominio (ADR-010 §1), así que vive en el almacenamiento del webview. Sin DOM.

export interface Panel {
  open: boolean;
  width: number;
}

/** El ancho del lateral de siempre. */
export const PANEL_DEFAULT: Panel = { open: true, width: 320 };
export const PANEL_MIN = 260;
export const PANEL_MAX = 640;
const KEY = "togi.mesa.panel";

/** Un ancho dentro de los límites, en píxeles enteros. */
export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT.width;
  return Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width)));
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** Lo guardado, o lo de siempre si no hay nada o no se entiende. */
export function readPanel(store: Store | undefined): Panel {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return PANEL_DEFAULT;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== "object" || saved === null) return PANEL_DEFAULT;
    const { open, width } = saved as Record<string, unknown>;
    return {
      open: typeof open === "boolean" ? open : PANEL_DEFAULT.open,
      width: typeof width === "number" ? clampWidth(width) : PANEL_DEFAULT.width,
    };
  } catch {
    return PANEL_DEFAULT;
  }
}

/** Guarda el panel. Si el almacenamiento falla, el panel sigue funcionando sin recordar. */
export function writePanel(store: Store | undefined, panel: Panel): void {
  try {
    store?.setItem(KEY, JSON.stringify({ open: panel.open, width: clampWidth(panel.width) }));
  } catch {
    // Sin almacenamiento no se recuerda; no es un error de la mesa.
  }
}

/**
 * ⌘⌥\ pliega y despliega el panel; ⌘\ sigue siendo la columna de proyectos. Con ⌥, macOS cambia la
 * tecla que llega según la distribución del teclado, así que también vale la tecla física.
 */
export function isPanelShortcut(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (!e.metaKey || !e.altKey || e.ctrlKey || e.shiftKey) return false;
  return e.key === "\\" || e.code === "Backslash";
}

/** El ancho al arrastrar el borde: hacia la izquierda, el panel crece. */
export function dragged(startWidth: number, startX: number, x: number): number {
  return clampWidth(startWidth + (startX - x));
}
