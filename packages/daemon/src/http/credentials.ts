import { SetAgentCredential } from "@togi/core";
import { Hono } from "hono";
import {
  type AgentCredentials,
  InconsistentCredentialsError,
} from "../credentials/agent-credential.ts";
import type { AppEnv } from "./app.ts";
import { problem } from "./problem.ts";

/**
 * Credenciales del agente. El secreto entra en el cuerpo y nunca sale: ni en la respuesta, ni en
 * los errores (detalles fijos, sin eco del cuerpo).
 */
export function credentialRoutes(credentials: AgentCredentials | undefined) {
  return new Hono<AppEnv>()
    .get("/v1/agent-credential", async (c) => {
      if (credentials === undefined)
        return problem(503, "not_configured", "credenciales no disponibles");
      try {
        return c.json({ mode: await credentials.status() });
      } catch {
        return problem(500, "credential_store_error", "no se pudo consultar el almacén");
      }
    })
    .put("/v1/agent-credential", async (c) => {
      if (credentials === undefined)
        return problem(503, "not_configured", "credenciales no disponibles");
      // La idempotencia guarda un hash del cuerpo; aquí el cuerpo es el secreto.
      if (c.req.header("idempotency-key") !== undefined) {
        return problem(
          400,
          "idempotency_key_not_allowed",
          "este recurso no admite Idempotency-Key",
        );
      }
      const json: unknown = await c.req.json().catch(() => undefined);
      const parsed = SetAgentCredential.safeParse(json);
      if (!parsed.success) return problem(400, "validation_error", "cuerpo no válido");
      try {
        await credentials.set(parsed.data.mode, parsed.data.secret);
        return c.json({ mode: parsed.data.mode });
      } catch (error) {
        if (error instanceof InconsistentCredentialsError) {
          return problem(409, "credentials_inconsistent", error.message);
        }
        return problem(500, "credential_store_error", "no se pudo guardar la credencial");
      }
    });
}
