import {
  Background,
  BackgroundVariant,
  Controls,
  type NodeChange,
  Panel,
  ReactFlow,
  useReactFlow,
  useStore,
  type Viewport,
} from "@xyflow/react";
import { createElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Si toca encuadrar: con todos los nodos medidos y salvo que sean los mismos que había al volver a la
 * mesa (`restored`), que se quedan con el encuadre que dejaste.
 */
export const shouldRefit = (ids: string, measured: boolean, restored: string | null): boolean =>
  measured && ids !== restored;

/** Cuando entra o sale alguien de la mesa, la vuelve a encuadrar; si solo cambian los textos, no. */
function Refit({ ids, measured }: { ids: string; measured: boolean }): null {
  const { fitView } = useReactFlow();
  // Al volver a la mesa con los mismos nodos, se queda el encuadre que dejaste: solo esa primera vez.
  const restored = useRef(mesaMemory.viewport !== null && ids === mesaMemory.ids ? ids : null);
  useEffect(() => {
    mesaMemory.ids = ids;
  }, [ids]);
  // Encuadra cuando cambia quién está, en cuanto todos los nodos están medidos y un fotograma
  // después, con las medidas ya en React Flow. Si se le pide antes, lo deja en cola y, con una plaza
  // nueva, la cola no siempre se vacía: la plaza se quedaba fuera del mapa.
  useEffect(() => {
    if (!shouldRefit(ids, measured, restored.current)) return;
    restored.current = null;
    mesaMemory.framed = true;
    const frame = requestAnimationFrame(() => void fitView({ ...FIT, duration: 300 }));
    return () => cancelAnimationFrame(frame);
  }, [ids, measured, fitView]);
  // Si cambia el tamaño de la ventana y el encuadre lo puso la mesa, vuelve a encuadrar: si no, al
  // agrandar la ventana la mesa se quedaba en una esquina. Si lo moviste tú, se respeta.
  const size = useStore((s) => `${Math.round(s.width)}x${Math.round(s.height)}`);
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo lo dispara el tamaño.
  useEffect(() => {
    if (!measured || !mesaMemory.framed || size === "0x0") return;
    const frame = requestAnimationFrame(() => void fitView(FIT));
    return () => cancelAnimationFrame(frame);
  }, [size]);
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
  /** La tarea abierta en el lateral: sus plazas se marcan. */
  selected?: number | null;
  /** Pulsar una plaza abre su tarea en el lateral. */
  onSelect?: (task: number) => void;
}

export function MesaMap({ state, waiting, titles, selected, onSelect }: Props): ReactNode {
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
  // La tarea de cada plaza, para marcarla y para abrirla en el lateral al pulsarla.
  const taskOf = useMemo(
    () => new Map(state.seats.map((s) => [s.key, s.number] as const)),
    [state],
  );
  const nodes = useMemo(
    () =>
      flow.nodes.map((n) => {
        const measured = sizes.get(n.id);
        const mark =
          selected != null && taskOf.get(n.id) === selected ? { className: "is-selected" } : {};
        return { ...n, ...mark, ...(measured ? { measured } : {}) };
      }),
    [flow, sizes, selected, taskOf],
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
        onNodeClick: (_: unknown, clicked: MesaNode) => {
          const task = taskOf.get(clicked.id);
          if (task !== undefined) onSelect?.(task);
        },
        // Un tamaño fijo solo al pintar sin navegador (los tests); en la app, React Flow mide su hueco
        // y encuadra con él.
        ...(typeof window === "undefined" ? { width: 880, height: 660 } : {}),
        // Si ya habías estado en la mesa, vuelve con tu encuadre; si no, encuadra.
        ...(mesaMemory.viewport
          ? { defaultViewport: mesaMemory.viewport }
          : { fitView: true, fitViewOptions: FIT }),
        onMoveEnd: (event: unknown, viewport: Viewport) => {
          mesaMemory.viewport = viewport;
          // Con evento, lo movió alguien (ratón, rueda); sin él, la mesa, al encuadrar.
          if (event) mesaMemory.framed = false;
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
      createElement(Refit, {
        ids: flow.nodes.map((n) => n.id).join(" "),
        measured: flow.nodes.every((n) => sizes.has(n.id)),
      }),
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
