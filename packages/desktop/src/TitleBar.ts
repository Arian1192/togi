import { createElement, type ReactNode } from "react";

// La barra de título la pinta la web (titleBarStyle Overlay en tauri.conf.json), como en T3: el
// control que pliega la columna va junto a los semáforos, fuera de la columna, así que no compite
// con nada de ella. Sin JSX a propósito: los tests corren con `node --test`.

interface Props {
  collapsed: boolean;
  onCollapse: () => void;
  /** A pantalla completa macOS oculta los semáforos: la barra deja de reservarles sitio. */
  fullscreen: boolean;
}

const SHORTCUT = "⌘\\";

// Icono de Lucide (https://lucide.dev, licencia ISC): panel-left, con el trazo de 1,5 px de la marca.
const PANEL_LEFT = { rect: { x: 3, y: 3, width: 18, height: 18, rx: 2 }, line: "M9 3v18" } as const;

export function TitleBar({ collapsed, onCollapse, fullscreen }: Props): ReactNode {
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
  );
}
