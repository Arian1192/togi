import {
  type BlobRef,
  CreateTask,
  EditTask,
  RejectTask,
  SAFE_ID,
  VersionConflictError,
} from "@togi/core";
import type Database from "better-sqlite3";
import { type Context, Hono } from "hono";
import type { createHandler } from "../commands/handle-command.ts";
import type { AppEnv } from "./app.ts";
import { hashBody, idempotencyKeys, type SavedResponse } from "./idempotency.ts";
import { domainStatus, problem } from "./problem.ts";
import { titleReader } from "./title.ts";

type Handle = ReturnType<typeof createHandler>;
type Parser<T> = {
  safeParse(
    v: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
};
type Result = Awaited<ReturnType<Handle>>;

const IF_MATCH = /^"?(\d+)"?$/;
export const NUMBER = /^[1-9]\d*$/;

interface TaskRow {
  number: number;
  /** BlobRef del título en JSON. */
  title: string;
  state: string;
  risk: string;
  repo: string;
  base_branch: string;
  has_criteria: number;
  stream_version: number;
}

/**
 * Rutas de comandos del ADR-005, encadenadas para que `hc` infiera sus tipos. El actor sale
 * siempre del token, nunca del cuerpo. Sin `handle` las rutas existen pero responden 503.
 */
export function taskRoutes(db: Database.Database, handle: Handle | undefined) {
  const select = (conn: Database.Database, number: number) =>
    conn
      .prepare(
        "SELECT number, title, state, risk, repo, base_branch, has_criteria, stream_version FROM tasks WHERE number = ?",
      )
      .get(number) as TaskRow;
  const keys = idempotencyKeys(db);
  const titleOf = titleReader(db);
  // Lo que se guarda para repetir una respuesta lleva la referencia al título, nunca el texto.
  const snapshot = (row: TaskRow) => ({
    number: row.number,
    titleRef: JSON.parse(row.title) as BlobRef,
    state: row.state,
    risk: row.risk,
    repo: row.repo,
    baseBranch: row.base_branch,
    hasCriteria: row.has_criteria === 1,
    version: row.stream_version,
  });
  // Los snapshots guardados antes no tienen los campos nuevos: se repiten tal como se guardaron.
  type Snapshot = ReturnType<typeof snapshot>;
  const taskBody = async (h: Handle, { titleRef, ...rest }: Snapshot) =>
    JSON.stringify({
      number: rest.number,
      ...(await titleOf(h.readText, titleRef)),
      state: rest.state,
      risk: rest.risk,
      repo: rest.repo,
      baseBranch: rest.baseBranch,
      hasCriteria: rest.hasCriteria,
      version: rest.version,
    });
  /** Un título que no se puede leer (y no está borrado) es un error de integridad. */
  const readable = async (render: () => Promise<Response>): Promise<Response> => {
    try {
      return await render();
    } catch {
      return problem(500, "integrity_error", "no se pudo leer el título de la tarea");
    }
  };
  const taskResponse = (status: number, json: string, version: number) =>
    new Response(json, {
      status,
      headers: { "content-type": "application/json", etag: `"${version}"` },
    });

  /** If-Match: la versión vista, con o sin comillas. Ausente → 428; `*` o ilegible → 400. */
  const ifMatch = (c: Context<AppEnv>): number | Response => {
    const raw = c.req.header("if-match");
    if (raw === undefined) return problem(428, "precondition_required", "falta If-Match");
    const version = IF_MATCH.exec(raw.trim())?.[1];
    if (version === undefined) {
      return problem(400, "invalid_if_match", "If-Match debe ser la versión vista; no se admite *");
    }
    return Number(version);
  };

  const readJson = async (c: Context<AppEnv>): Promise<unknown> => {
    const json: unknown = await c.req.json().catch(() => undefined);
    return json === undefined ? problem(400, "invalid_json", "el cuerpo no es JSON") : json;
  };

  const validate = <T>(json: unknown, schema: Parser<T>): T | Response => {
    const parsed = schema.safeParse(json);
    return parsed.success ? parsed.data : problem(400, "validation_error", parsed.error.message);
  };

  const body = async <T>(c: Context<AppEnv>, schema: Parser<T>): Promise<T | Response> => {
    const json = await readJson(c);
    return json instanceof Response ? json : validate(json, schema);
  };

  const respond = async (h: Handle, result: Result, status: 200 | 201): Promise<Response> => {
    if ("kind" in result && result.kind === "precondition_failed") {
      return problem(412, "precondition_failed", `la versión actual es ${result.current}`, {
        etag: `"${result.current}"`,
      });
    }
    if ("kind" in result) {
      return problem(domainStatus(result.code), result.code, result.message);
    }
    const row = select(db, (result as { number: number }).number);
    return readable(async () =>
      taskResponse(status, await taskBody(h, snapshot(row)), row.stream_version),
    );
  };

  /** El comando perdió la carrera contra otra escritura: 409, no 500. */
  const guard = async (run: (handle: Handle) => Promise<Response>): Promise<Response> => {
    if (handle === undefined) return problem(503, "not_configured", "comandos no disponibles");
    try {
      return await run(handle);
    } catch (error) {
      if (error instanceof VersionConflictError) {
        return problem(409, "version_conflict", "otra escritura se adelantó; vuelve a leer");
      }
      throw error;
    }
  };

  const existing =
    <T>(schema: Parser<T> | null, command: (number: number, input: T) => Parameters<Handle>[1]) =>
    (c: Context<AppEnv>) =>
      guard(async (handle) => {
        const param = c.req.param("n") ?? "";
        if (!NUMBER.test(param)) return problem(404, "task_not_found", "tarea inexistente");
        const version = ifMatch(c);
        if (version instanceof Response) return version;
        const input = schema === null ? ({} as T) : await body(c, schema);
        if (input instanceof Response) return input;
        const result = await handle(c.get("actor"), command(Number(param), input), {
          ifMatch: version,
          correlationId: c.get("requestId"),
        });
        return respond(handle, result, 200);
      });

  // La decisión recae siempre sobre el último plan; If-Match protege de un plan nuevo intermedio.
  const latestPlan = db.prepare(
    "SELECT COALESCE(MAX(plan_version), 0) AS v FROM plans WHERE task_number = ?",
  );
  const planVersion = (number: number) => (latestPlan.get(number) as { v: number }).v;

  return (
    new Hono<AppEnv>()
      .post("/v1/tasks", (c) =>
        guard(async (handle) => {
          const key = c.req.header("idempotency-key");
          if (key !== undefined && !SAFE_ID.test(key)) {
            return problem(
              400,
              "invalid_idempotency_key",
              "Idempotency-Key no tiene formato seguro",
            );
          }
          const json = await readJson(c);
          if (json instanceof Response) return json;
          const input = validate(json, CreateTask);
          if (input instanceof Response) return input;
          const command = { type: "create", ...input, source: { kind: "cli" } } as const;
          const correlationId = c.get("requestId");
          const actor = c.get("actor");
          if (key === undefined || actor.kind !== "human") {
            return respond(handle, await handle(actor, command, { correlationId }), 201);
          }
          let requestHash: string;
          try {
            requestHash = hashBody(json);
          } catch {
            return problem(400, "invalid_json", "el cuerpo no es JSON canonicalizable");
          }
          const replay = async (saved: SavedResponse | undefined) => {
            if (saved === undefined) return undefined;
            if (saved.request_hash !== requestHash) {
              return problem(422, "idempotency_key_reused", "la clave ya se usó con otro cuerpo");
            }
            const snap = JSON.parse(saved.response_body) as Snapshot;
            return readable(async () =>
              taskResponse(saved.status, await taskBody(handle, snap), snap.version),
            );
          };
          const previous = await replay(keys.find(actor.userId, key));
          if (previous !== undefined) return previous;
          try {
            const result = await handle(actor, command, {
              correlationId,
              // Misma transacción que la tarea: la clave y su respuesta nacen o se revierten juntas.
              onCommit: (stored, tx) => {
                const stream = stored[0]?.stream ?? "";
                const row = select(tx, Number(stream.slice("task:".length)));
                const saved = {
                  request_hash: requestHash,
                  status: 201,
                  response_body: JSON.stringify(snapshot(row)),
                };
                keys.save(tx, actor.userId, key, saved);
              },
            });
            return await respond(handle, result, 201);
          } catch (error) {
            // Una carrera con la misma clave rompe la PK. Solo si la clave existe es eso; si no, es
            // otra restricción y el error original sigue su camino.
            const code = (error as { code?: string }).code;
            const raced =
              code === "SQLITE_CONSTRAINT_PRIMARYKEY"
                ? await replay(keys.find(actor.userId, key))
                : undefined;
            if (raced !== undefined) return raced;
            throw error;
          }
        }),
      )
      .patch(
        "/v1/tasks/:n",
        existing(EditTask, (number, input) => ({
          type: "edit",
          number,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.acceptanceCriteria === undefined
            ? {}
            : { acceptanceCriteria: input.acceptanceCriteria }),
        })),
      )
      .post(
        "/v1/tasks/:n/submit",
        existing(null, (number) => ({ type: "submit", number })),
      )
      .post(
        "/v1/tasks/:n/reject",
        existing(RejectTask, (number, { reason }) => ({
          type: "reject",
          number,
          category: reason.category,
          text: reason.text,
        })),
      )
      .post(
        "/v1/tasks/:n/plan/approve",
        existing(null, (number) => ({
          type: "approvePlan",
          number,
          planVersion: planVersion(number),
        })),
      )
      // Mismo cuerpo que reject: motivo con categoría.
      .post(
        "/v1/tasks/:n/plan/request-changes",
        existing(RejectTask, (number, { reason }) => ({
          type: "requestPlanChanges",
          number,
          planVersion: planVersion(number),
          category: reason.category,
          text: reason.text,
        })),
      )
      .post(
        "/v1/tasks/:n/plan/reject",
        existing(RejectTask, (number, { reason }) => ({
          type: "rejectPlan",
          number,
          planVersion: planVersion(number),
          category: reason.category,
          text: reason.text,
        })),
      )
  );
}
