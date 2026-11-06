import { Hono } from "hono";
import { PLANNER_NOT_CONFIGURED, type PlannerStatus } from "../orchestrator/planner-status.ts";
import type { AppEnv } from "./app.ts";

/** Estado del planificador: activo, desactivado o no disponible en esta plataforma. */
export function plannerRoutes(status: PlannerStatus = PLANNER_NOT_CONFIGURED) {
  return new Hono<AppEnv>().get("/v1/planner", (c) => c.json(status));
}
