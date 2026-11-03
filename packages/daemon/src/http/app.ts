import { readFileSync } from "node:fs";
import type { Actor, UserId } from "@togi/core";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import { authenticate, type TokenRow } from "../auth/tokens.ts";
import { SCHEMA_VERSION } from "../store/schema.ts";

const DAEMON_VERSION =
  (
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version?: string;
    }
  ).version ?? "0.0.0";

export type AppEnv = { Variables: { actor: Actor } };

const BEARER = /^Bearer +(\S+)$/i;

export function createApp(db: Database.Database) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const rows = db.prepare("SELECT token_hash, user_id FROM tokens").all() as TokenRow[];
    const userId = token === undefined ? null : authenticate(token, rows);
    if (userId === null) {
      return c.body(
        JSON.stringify({
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          code: "unauthorized",
        }),
        401,
        { "content-type": "application/problem+json", "www-authenticate": "Bearer" },
      );
    }
    c.set("actor", { kind: "human", userId: userId as UserId });
    await next();
  });

  app.get("/v1/health", (c) => c.json({ daemon: DAEMON_VERSION, schema: SCHEMA_VERSION }));
  return app;
}
