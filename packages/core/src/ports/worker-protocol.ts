import { z } from "zod";
import { AGENT_EVENT_KINDS } from "../integrity/agent-hash.ts";
import { SESSION_OUTCOMES } from "../model/planning.ts";

/**
 * Protocolo entre el daemon y el trabajador (ADR-008 §4): un mensaje JSON por línea, por la entrada
 * y la salida estándar. Todo son objetos estrictos: un campo de más es un mensaje no válido.
 */
const spec = z.strictObject({
  readPaths: z.array(z.string()),
  writeDir: z.string(),
  allowedDomains: z.array(z.string()),
  allowedEnv: z.array(z.string()),
  credentials: z.array(z.strictObject({ name: z.string(), injectDomains: z.array(z.string()) })),
  timeoutMs: z.number().int().positive(),
});

/** La orden de la sesión. La credencial viaja solo aquí: nunca por argumentos ni por entorno. */
const session = z.strictObject({
  type: z.literal("session"),
  sessionId: z.string().min(1),
  spec,
  /** `TOGI_HOME/workspaces`: la raíz donde el sandbox admite rutas. No es el token ni `TOGI_HOME`. */
  workspacesRoot: z.string(),
  /** Node y el código del agente, que el sandbox deja leer. Los pone el daemon. */
  runtimePaths: z.array(z.string()),
  argv: z.array(z.string()).min(1),
  input: z.string().optional(),
  credential: z.strictObject({ name: z.string(), secret: z.string().min(1) }).nullable(),
});

export const ToWorker = z.discriminatedUnion("type", [
  session,
  z.strictObject({ type: z.literal("cancel") }),
]);

export const FromWorker = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("event"),
    sessionId: z.string(),
    kind: z.enum(AGENT_EVENT_KINDS),
    payload: z.unknown(),
  }),
  z.strictObject({
    type: z.literal("result"),
    sessionId: z.string(),
    outcome: z.enum(SESSION_OUTCOMES),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("heartbeat") }),
  /** Mensaje fijo, nunca un eco de lo recibido: lo recibido puede llevar la credencial. */
  z.strictObject({ type: z.literal("error"), code: z.enum(["invalid_message", "busy"]) }),
]);

export type ToWorker = z.infer<typeof ToWorker>;
export type SessionOrder = Extract<ToWorker, { type: "session" }>;
export type FromWorker = z.infer<typeof FromWorker>;

export const encodeLine = (message: ToWorker | FromWorker): string =>
  `${JSON.stringify(message)}\n`;
