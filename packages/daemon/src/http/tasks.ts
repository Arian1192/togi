import { CreateTask, EditTask, RejectTask, VersionConflictError } from "@togi/core";
import type Database from "better-sqlite3";
import { type Context, Hono } from "hono";
import type { createHandler } from "../commands/handle-command.ts";
import type { AppEnv } from "./app.ts";
import { domainStatus, problem } from "./problem.ts";

type Handle = ReturnType<typeof createHandler>;
type Parser<T> = {
  safeParse(
    v: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
};
type Result = Awaited<ReturnType<Handle>>;

const IF_MATCH = /^"?(\d+)"?$/;
const NUMBER = /^[1-9]\d*$/;

interface TaskRow {
  number: number;
  title: string;
  state: string;
  risk: string;
  stream_version: number;
}

/**
 * Rutas de comandos del ADR-005, encadenadas para que `hc` infiera sus tipos. El actor sale
 * siempre del token, nunca del cuerpo. Sin `handle` las rutas existen pero responden 503.
 */
export function taskRoutes(db: Database.Database, handle: Handle | undefined) {
  const select = db.prepare(
    "SELECT number, title, state, risk, stream_version FROM tasks WHERE number = ?",
  );

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

  const body = async <T>(c: Context<AppEnv>, schema: Parser<T>): Promise<T | Response> => {
    const json: unknown = await c.req.json().catch(() => undefined);
    if (json === undefined) return problem(400, "invalid_json", "el cuerpo no es JSON");
    const parsed = schema.safeParse(json);
    return parsed.success ? parsed.data : problem(400, "validation_error", parsed.error.message);
  };

  const respond = (result: Result, status: 200 | 201): Response => {
    if ("kind" in result && result.kind === "precondition_failed") {
      return problem(412, "precondition_failed", `la versión actual es ${result.current}`, {
        etag: `"${result.current}"`,
      });
    }
    if ("kind" in result) {
      return problem(domainStatus(result.code), result.code, result.message);
    }
    const row = select.get((result as { number: number }).number) as TaskRow;
    return new Response(
      JSON.stringify({
        number: row.number,
        title: row.title,
        state: row.state,
        risk: row.risk,
        version: row.stream_version,
      }),
      {
        status,
        headers: { "content-type": "application/json", etag: `"${row.stream_version}"` },
      },
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
        return respond(result, 200);
      });

  return new Hono<AppEnv>()
    .post("/v1/tasks", (c) =>
      guard(async (handle) => {
        const input = await body(c, CreateTask);
        if (input instanceof Response) return input;
        const result = await handle(
          c.get("actor"),
          { type: "create", ...input, source: { kind: "cli" } },
          { correlationId: c.get("requestId") },
        );
        return respond(result, 201);
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
    );
}
