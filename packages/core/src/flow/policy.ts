/** Límites de tamaño del plan (ADR-007), compartidos por el decider y la CLI. */
export const PLAN_LIMITS = { maxProductionLines: 200, maxTotalLines: 500 } as const;

export interface FlowPolicy {
  maxProductionLines: typeof PLAN_LIMITS.maxProductionLines;
  maxTotalLines: typeof PLAN_LIMITS.maxTotalLines;
  maxFailedCycles: 3;
}
