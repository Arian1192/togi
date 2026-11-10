import {
  Background,
  BackgroundVariant,
  Controls,
  type NodeChange,
  Panel,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { createElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { MesaFlowEdge } from "./MesaFlowEdge.ts";
import { MesaFlowNode } from "./MesaFlowNode.ts";
import type { MesaState } from "./mesa.ts";
import { layout, type MesaEdge, type MesaNode } from "./mesaFlow.ts";
import { mesaMemory } from "./mesaMemory.ts";

// El mapa de la mesa en vivo sobre React Flow (pantalla 5 del diseño): puedes arrastrar cada nodo,
// desplazar el mapa y acercarlo. Nadie puede unir, seleccionar ni borrar nodos: las aristas las pone
// togi y van siempre a togi. Sin JSX.

const FIT = { padding: 0.08, maxZoom: 1 };
type Size = { width: number; height: number };

/** Cuando entra o sale alguien de la mesa, la vuelve a encuadrar; si solo cambian los textos, no. */
function Refit({ ids }: { ids: string }): null {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  useEffect(() => {
    if (!ready) return;
    // Al volver a la mesa con los mismos nodos, se queda el encuadre que dejaste.
    const same = ids === mesaMemory.ids && mesaMemory.viewport !== null;
    mesaMemory.ids = ids;
    if (!same) void fitView({ ...FIT, duration: 300 });
  }, [ids, ready, fitView]);
  return null;
}

const nodeTypes = { mesa: MesaFlowNode };
const edgeTypes = { mesa: MesaFlowEdge };

const ARIA = {
  "node.a11yDescription.default": "Un participante de la mesa. Arrástralo para moverlo.",
  "node.a11yDescription.keyboardDisabled": "Un participante de la mesa. Arrástralo para moverlo.",
  "edge.a11yDescription.default": "Un canal entre un participante y togi.",
  "controls.ariaLabel": "Controles del mapa",
  "controls.zoomIn.ariaLabel": "Acercar",
  "controls.zoomOut.ariaLabel": "Alejar",
  "controls.fitView.ariaLabel": "Encuadrar la mesa",
};

interface Props {
  state: MesaState;
  waiting: number;
  /** Los títulos de las tareas, por número: van encima de cada plaza. */
  titles?: ReadonlyMap<number, string>;
}

export function MesaMap({ state, waiting, titles }: Props): ReactNode {
  // Empieza donde la dejaste (mesaMemory.ts) y lo que mueves se recuerda al salir de la mesa.
  const [moved, setMoved] = useState(() => mesaMemory.moved);
  useEffect(() => {
    mesaMemory.moved = moved;
  }, [moved]);
  // Lo que React Flow mide de cada nodo vuelve en su `measured`: sin eso no los da por listos y no
  // encuadra (ni al entrar alguien ni con el botón).
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const flow = useMemo(
    () => layout(state, waiting, moved, titles),
    [state, waiting, moved, titles],
  );
  const nodes = useMemo(
    () =>
      flow.nodes.map((n) => {
        const measured = sizes.get(n.id);
        return measured ? { ...n, measured } : n;
      }),
    [flow, sizes],
  );
  // Solo se aplica lo que mueves tú y lo que mide React Flow; nada más cambia la mesa.
  const onNodesChange = (changes: NodeChange<MesaNode>[]) => {
    const drags = changes.flatMap((c) =>
      c.type === "position" && c.position ? [[c.id, c.position] as const] : [],
    );
    if (drags.length > 0) setMoved((prev) => new Map([...prev, ...drags]));
    const measured = changes.flatMap((c) =>
      c.type === "dimensions" && c.dimensions ? [[c.id, c.dimensions] as const] : [],
    );
    if (measured.length > 0) setSizes((prev) => new Map([...prev, ...measured]));
  };
  return createElement(
    "div",
    { className: "mesa-map", "aria-label": `Mesa en vivo: ${flow.active} sesiones activas` },
    createElement(
      ReactFlow<MesaNode, MesaEdge>,
      {
        nodes,
        edges: flow.edges,
        nodeTypes,
        edgeTypes,
        onNodesChange,
        // Un tamaño fijo solo al pintar sin navegador (los tests); en la app, React Flow mide su hueco
        // y encuadra con él.
        ...(typeof window === "undefined" ? { width: 880, height: 660 } : {}),
        // Si ya habías estado en la mesa, vuelve con tu encuadre; si no, encuadra.
        ...(mesaMemory.viewport
          ? { defaultViewport: mesaMemory.viewport }
          : { fitView: true, fitViewOptions: FIT }),
        onMoveEnd: (_: unknown, viewport: Viewport) => {
          mesaMemory.viewport = viewport;
        },
        minZoom: 0.4,
        maxZoom: 2,
        nodesConnectable: false,
        elementsSelectable: false,
        nodesFocusable: false,
        edgesFocusable: false,
        deleteKeyCode: null,
        ariaLabelConfig: ARIA,
        // El crédito a React Flow va en el código y en el PR: un enlace externo no tiene sitio aquí.
        proOptions: { hideAttribution: true },
      },
      createElement(Background, { variant: BackgroundVariant.Dots, gap: 22, size: 1.5 }),
      createElement(Refit, { ids: flow.nodes.map((n) => n.id).join(" ") }),
      // El botón de encuadrar usa el mismo encuadre que al abrir la mesa.
      createElement(Controls, {
        showInteractive: false,
        fitViewOptions: { ...FIT, duration: 300 },
      }),
      createElement(
        Panel,
        { position: "bottom-center", className: "mesa-caption" },
        "Los agentes no se hablan entre sí: cada mensaje pasa por togi y queda en el log con su hash.",
      ),
    ),
  );
}
