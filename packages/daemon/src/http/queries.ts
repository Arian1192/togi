import { TASK_STATES, type TaskState } from "@togi/core";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { AppEnv } from "./app.ts";
import { problem } from "./problem.ts";

const LIMIT = /^\d+$/;

interface TaskRow {
  number: number;
  title: string;
  state: string;
  risk: string;
  stream_version: number;
}

/** Consultas del ADR-005, encadenadas para que `hc` infiera sus tipos. */
export function queryRoutes(db: Database.Database) {
  const list = (state: string | undefined, limit: number) =>
    db
      .prepare(
        `SELECT number, title, state, risk, stream_version FROM tasks
         ${state === undefined ? "" : "WHERE state = ?"} ORDER BY number LIMIT ?`,
      )
      .all(...(state === undefined ? [limit] : [state, limit])) as TaskRow[];

  return new Hono<AppEnv>().get("/v1/tasks", (c) => {
    const state = c.req.query("state");
    if (state !== undefined && !TASK_STATES.includes(state as TaskState)) {
      return problem(400, "validation_error", `state debe ser uno de ${TASK_STATES.join(", ")}`);
    }
    const raw = c.req.query("limit") ?? "50";
    const limit = LIMIT.test(raw) ? Number(raw) : 0;
    if (limit < 1 || limit > 200) {
      return problem(400, "validation_error", "limit debe ser un entero entre 1 y 200");
    }
    const tasks = list(state, limit).map((r) => ({
      number: r.number,
      title: r.title,
      state: r.state,
      risk: r.risk,
      version: r.stream_version,
    }));
    return c.json({ tasks });
  });
}
