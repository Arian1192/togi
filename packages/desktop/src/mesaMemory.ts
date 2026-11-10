import type { Viewport } from "@xyflow/react";
import type { Point } from "./mesaFlow.ts";

/**
 * Lo que la mesa recuerda mientras la app está abierta, aunque cambies a las tareas (⌘1) y vuelvas
 * (⌘2): dónde dejaste cada nodo, el encuadre (desplazamiento y zoom) y quién estaba en la mesa cuando
 * la dejaste, para no reencuadrar al volver si nadie ha entrado ni salido. Al cerrar la app se olvida.
 */
export interface MesaMemory {
  moved: ReadonlyMap<string, Point>;
  viewport: Viewport | null;
  /** Los nodos que había, en orden (`id id id`). */
  ids: string | null;
}

export const mesaMemory: MesaMemory = { moved: new Map(), viewport: null, ids: null };
