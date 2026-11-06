/** Si el daemon planifica con un agente, y si no, por qué. Lo ve `togi daemon status`. */
export interface PlannerStatus {
  state: "active" | "disabled" | "unavailable";
  /** Texto fijo del daemon, nunca datos de usuario. */
  reason: string;
}

export const PLANNER_ACTIVE: PlannerStatus = { state: "active", reason: "agente real en sandbox" };
export const PLANNER_NOT_CONFIGURED: PlannerStatus = {
  state: "disabled",
  reason: "no se configuró ningún planificador",
};
