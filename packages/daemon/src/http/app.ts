import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type Actor, SAFE_ID, type UserId } from "@togi/core";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { authenticate, type TokenRow } from "../auth/tokens.ts";
import type { createHandler } from "../commands/handle-command.ts";
import type { AgentCredentials } from "../credentials/agent-credential.ts";
import type { PlannerStatus } from "../orchestrator/planner-status.ts";
import { SCHEMA_VERSION } from "../store/schema.ts";
import { adminRoutes } from "./admin.ts";
import { credentialRoutes } from "./credentials.ts";
import { eventRoutes } from "./events.ts";
import { plannerRoutes } from "./planner.ts";
import { planRoutes } from "./plans.ts";
import { problem } from "./problem.ts";
import { queryRoutes, type ReadDeps } from "./queries.ts";
import { repoRoutes } from "./repos.ts";
import { taskRoutes } from "./tasks.ts";

const DAEMON_VERSION =
  (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version?: string;
    }
  ).version ?? "0.0.0";

export type AppEnv = { Variables: { actor: Actor; requestId: string } };

const BEARER = /^Bearer +(\S+)$/i;

/** Tipo de la app para el cliente `hc` de la CLI. */
export type AppType = ReturnType<typeof createApp>;

export function createApp(
  db: Database.Database,
  handle?: ReturnType<typeof createHandler>,
  reads?: ReadDeps,
  /** Directorio de datos de togi: el registro de repos rechaza rutas dentro de él. */
  home?: string,
  credentials?: AgentCredentials,
  planner?: PlannerStatus,
) {
  // Rutas encadenadas: `hc` solo infiere los tipos de lo que se encadena aquí.
  return new Hono<AppEnv>()
    .use("*", requestId)
    .use("*", authenticated(db))
    .get("/v1/health", (c) => {
      // Seq del último evento del log (0 si está vacío): `togi watch` conecta desde aquí.
      const { lastSeq } = db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS lastSeq FROM events")
        .get() as {
        lastSeq: number;
      };
      return c.json({ daemon: DAEMON_VERSION, schema: SCHEMA_VERSION, pid: process.pid, lastSeq });
    })
    .route("/", taskRoutes(db, handle, planner))
    .route("/", queryRoutes(db, reads, handle))
    .route("/", planRoutes(db, reads, handle))
    .route("/", repoRoutes(db, home))
    .route("/", eventRoutes(reads))
    .route("/", adminRoutes(reads))
    .route("/", credentialRoutes(credentials))
    .route("/", plannerRoutes(planner));
}

// El id del cliente se usa solo si es razonable: acaba en el log de eventos y en cabeceras.
const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const sent = c.req.header("x-request-id");
  const id = sent !== undefined && SAFE_ID.test(sent) ? sent : randomUUID();
  c.set("requestId", id);
  await next();
  c.res.headers.set("x-request-id", id);
});

const authenticated = (db: Database.Database) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const rows = db.prepare("SELECT token_hash, user_id FROM tokens").all() as TokenRow[];
    const userId = token === undefined ? null : authenticate(token, rows);
    if (userId === null) {
      return problem(401, "unauthorized", undefined, { "www-authenticate": "Bearer" });
    }
    c.set("actor", { kind: "human", userId: userId as UserId });
    await next();
  });
