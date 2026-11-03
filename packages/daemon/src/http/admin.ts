import { Hono } from "hono";
import type { AppEnv } from "./app.ts";
import { problem } from "./problem.ts";
import type { ReadDeps } from "./queries.ts";

/** Administración (ADR-005). `verify-log` responde 200 con el veredicto, íntegro o no. */
export function adminRoutes(reads: ReadDeps | undefined) {
  return new Hono<AppEnv>().post("/v1/admin/verify-log", async (c) => {
    if (reads === undefined) return problem(503, "not_configured", "consultas no disponibles");
    return c.json(await reads.store.verify());
  });
}
