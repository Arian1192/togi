import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Actor, UserId } from "@togi/core";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { authenticate, type TokenRow } from "../auth/tokens.ts";
import type { createHandler } from "../commands/handle-command.ts";
import { SCHEMA_VERSION } from "../store/schema.ts";
import { problem } from "./problem.ts";
import { registerTaskRoutes } from "./tasks.ts";

const DAEMON_VERSION =
  (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version?: string;
    }
  ).version ?? "0.0.0";

export type AppEnv = { Variables: { actor: Actor; requestId: string } };

const BEARER = /^Bearer +(\S+)$/i;
const REQUEST_ID = /^[\w.:-]{1,128}$/;

export function createApp(db: Database.Database, handle?: ReturnType<typeof createHandler>) {
  const app = new Hono<AppEnv>();

  // El id del cliente se usa solo si es razonable: acaba en el log de eventos y en cabeceras.
  app.use("*", async (c, next) => {
    const sent = c.req.header("x-request-id");
    const requestId = sent !== undefined && REQUEST_ID.test(sent) ? sent : randomUUID();
    c.set("requestId", requestId);
    await next();
    c.res.headers.set("x-request-id", requestId);
  });

  app.use("*", async (c, next) => {
    const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const rows = db.prepare("SELECT token_hash, user_id FROM tokens").all() as TokenRow[];
    const userId = token === undefined ? null : authenticate(token, rows);
    if (userId === null) {
      return problem(401, "unauthorized", undefined, { "www-authenticate": "Bearer" });
    }
    c.set("actor", { kind: "human", userId: userId as UserId });
    await next();
  });

  app.get("/v1/health", (c) => c.json({ daemon: DAEMON_VERSION, schema: SCHEMA_VERSION }));
  if (handle !== undefined) registerTaskRoutes(app, db, handle);
  return app;
}
