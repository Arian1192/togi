import { createElement, type ReactNode } from "react";

// La barra de título la pinta la web (titleBarStyle Overlay en tauri.conf.json), como en T3: el
// control que pliega la columna va junto a los semáforos, fuera de la columna, así que no compite
// con nada de ella. Sin JSX a propósito: los tests corren con `node --test`.

interface Props {
  collapsed: boolean;
  onCollapse: () => void;
  /** A pantalla completa macOS oculta los semáforos: la barra deja de reservarles sitio. */
  fullscreen: boolean;
  /** Si está la mesa en vivo en pantalla; con `onMesa`, la barra lleva «Tareas ⌘1» y «Mesa ⌘2». */
  mesa?: boolean;
  onMesa?: (open: boolean) => void;
  /** El panel derecho de la mesa: con él, la barra termina con su control. Solo en la mesa. */
  panel?: { open: boolean; onToggle: () => void };
}

const navButton = (label: string, key: string, pressed: boolean, onClick: () => void) =>
  createElement(
    "button",
    {
      key,
      type: "button",
      className: "titlebar-nav",
      "aria-pressed": pressed,
      title: `${label} (⌘${key})`,
      onClick,
    },
    label,
    createElement("kbd", null, `⌘${key}`),
  );

const SHORTCUT = "⌘\\";

// Icono de Lucide (https://lucide.dev, licencia ISC): panel-left, con el trazo de 1,5 px de la marca.
// panel-right es el mismo en espejo: la línea a la derecha.
const RECT = { x: 3, y: 3, width: 18, height: 18, rx: 2 } as const;
const PANEL_LEFT = { rect: RECT, line: "M9 3v18" } as const;
const PANEL_RIGHT = "M15 3v18";

/** El control del panel derecho, en espejo del de la columna, con su atajo ⌘⌥\. */
const panelToggle = ({ open, onToggle }: NonNullable<Props["panel"]>) => {
  const label = open ? "Plegar el panel" : "Desplegar el panel";
  return createElement(
    "button",
    {
      type: "button",
      className: "titlebar-toggle titlebar-panel",
      "aria-label": label,
      "aria-expanded": open,
      title: `${label} (⌘⌥\\)`,
      onClick: onToggle,
    },
    createElement(
      "svg",
      { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", "aria-hidden": true },
      createElement("rect", { ...RECT, stroke: "currentColor", strokeWidth: 1.5 }),
      createElement("path", { d: PANEL_RIGHT, stroke: "currentColor", strokeWidth: 1.5 }),
    ),
  );
};

export function TitleBar({
  collapsed,
  onCollapse,
  fullscreen,
  mesa,
  onMesa,
  panel,
}: Props): ReactNode {
  const label = collapsed ? "Desplegar la columna" : "Plegar la columna";
  return createElement(
    "header",
    {
      className: "titlebar",
      // La barra arrastra la ventana; el botón no lleva el atributo, así que sigue siendo un botón.
      "data-tauri-drag-region": true,
      "data-fullscreen": fullscreen ? "true" : "false",
    },
    createElement(
      "button",
      {
        type: "button",
        className: "titlebar-toggle",
        "aria-label": label,
        "aria-expanded": !collapsed,
        title: `${label} (${SHORTCUT})`,
        onClick: onCollapse,
      },
      createElement(
        "svg",
        { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", "aria-hidden": true },
        createElement("rect", { ...PANEL_LEFT.rect, stroke: "currentColor", strokeWidth: 1.5 }),
        createElement("path", { d: PANEL_LEFT.line, stroke: "currentColor", strokeWidth: 1.5 }),
      ),
    ),
    onMesa &&
      createElement(
        "nav",
        { className: "titlebar-views", "aria-label": "Vistas" },
        navButton("Tareas", "1", mesa !== true, () => onMesa(false)),
        navButton("Mesa en vivo", "2", mesa === true, () => onMesa(true)),
      ),
    panel && panelToggle(panel),
  );
}
