import type { BlobRef, BlobStore } from "@togi/core";
import type Database from "better-sqlite3";
import { Hono } from "hono";
import type { AppEnv } from "./app.ts";
import { problem } from "./problem.ts";
import { NUMBER } from "./tasks.ts";
import type { TextReader } from "./title.ts";

interface PlanRow {
  plan_version: number;
  session_id: string;
  base_sha: string;
  files: string;
  new_tests: string;
  approach: string;
  estimated_production: number;
  estimated_tests: number;
  proposed_at: string;
}

interface SessionRow {
  session_id: string;
  role: string;
  runtime: string;
  model: string;
  specialist: string;
  state: string;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
  usage: string | null;
  failure_reason: string | null;
}

const ERASED = "[borrado]";

/**
 * Consultas de planes y sesiones. Salen de las proyecciones; el enfoque se descifra al leerlo y
 * las versiones anteriores no lo incluyen. Sin lector de blobs, `GET /plan` responde 503.
 */
export function planRoutes(
  db: Database.Database,
  reads: { blobs: BlobStore } | undefined,
  handle?: { readText: TextReader },
) {
  const reader: TextReader | undefined =
    handle?.readText ??
    (reads && (async (ref) => new TextDecoder().decode(await reads.blobs.get(ref))));
  const task = db.prepare("SELECT stream_version FROM tasks WHERE number = ?");
  const keyExists = db.prepare("SELECT 1 FROM data_keys WHERE key_id = ?");
  const plans = db.prepare("SELECT * FROM plans WHERE task_number = ? ORDER BY plan_version DESC");
  const sessions = db.prepare(
    "SELECT * FROM sessions WHERE task_number = ? ORDER BY started_at, session_id",
  );
  const summary = (p: PlanRow) => ({
    planVersion: p.plan_version,
    sessionId: p.session_id,
    baseSha: p.base_sha,
    files: JSON.parse(p.files) as unknown,
    newTests: JSON.parse(p.new_tests) as unknown,
    estimatedLines: { production: p.estimated_production, tests: p.estimated_tests },
    proposedAt: p.proposed_at,
  });
  const exists = (param: string) =>
    NUMBER.test(param)
      ? (task.get(Number(param)) as { stream_version: number } | undefined)
      : undefined;

  return new Hono<AppEnv>()
    .get("/v1/tasks/:n/plan", async (c) => {
      const found = exists(c.req.param("n"));
      if (found === undefined) return problem(404, "task_not_found", "tarea inexistente");
      if (reader === undefined) return problem(503, "not_configured", "consultas no disponibles");
      const [latest, ...previous] = plans.all(Number(c.req.param("n"))) as PlanRow[];
      if (latest === undefined) return problem(404, "plan_not_found", "la tarea no tiene plan");
      const ref = JSON.parse(latest.approach) as BlobRef;
      const erased = keyExists.get(ref.keyId) === undefined;
      try {
        const approach = erased ? ERASED : await reader(ref);
        c.header("etag", `"${found.stream_version}"`);
        return c.json({
          ...summary(latest),
          approach,
          approachErased: erased,
          previous: previous.map(summary),
        });
      } catch {
        return problem(500, "integrity_error", "no se pudo leer el enfoque del plan");
      }
    })
    .get("/v1/tasks/:n/sessions", (c) => {
      if (exists(c.req.param("n")) === undefined) {
        return problem(404, "task_not_found", "tarea inexistente");
      }
      const rows = sessions.all(Number(c.req.param("n"))) as SessionRow[];
      return c.json({
        sessions: rows.map((s) => ({
          sessionId: s.session_id,
          role: s.role,
          runtime: s.runtime,
          model: s.model,
          specialist: s.specialist,
          state: s.state,
          startedAt: s.started_at,
          endedAt: s.ended_at,
          outcome: s.outcome,
          failureReason: s.failure_reason,
          usage: s.usage === null ? null : (JSON.parse(s.usage) as unknown),
        })),
      });
    });
}
