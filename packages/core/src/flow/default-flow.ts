import { BUILTIN_SPECIALISTS } from "../catalog/generic-planner.ts";
import type { Specialist } from "../model/specialist.ts";

/** Referencia a una versión concreta de un especialista del catálogo. */
export interface SpecialistRef {
  id: string;
  version: number;
}

/**
 * Recorrido de una tarea (ADR-009), como datos: quién produce cada etapa y qué evaluadores se
 * enganchan. Las etapas las fija el decider; esto solo dice quién las ocupa.
 */
export interface FlowConfig {
  planning: { producer: SpecialistRef };
  evaluators: readonly never[];
}

/** El flujo de quien no configura nada: un planificador y ningún evaluador. */
export const DEFAULT_FLOW: FlowConfig = {
  planning: { producer: { id: "generic-planner", version: 1 } },
  evaluators: [],
};

/** El especialista exacto que ocupa la etapa de planificación, o `undefined` si el catálogo no lo tiene. */
export function planningProducer(
  flow: FlowConfig,
  catalog: readonly Specialist[] = BUILTIN_SPECIALISTS,
): Specialist | undefined {
  const { id, version } = flow.planning.producer;
  return catalog.find((s) => s.id === id && s.version === version);
}
