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
  workTree: z.string().optional(),
  pnpmLocks: z.boolean().optional(),
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

const cancel = z.strictObject({ type: z.literal("cancel") });

/** Lo que manda el lanzador de sesiones del agente. */
export const ToWorker = z.discriminatedUnion("type", [session, cancel]);

/**
 * La instalación de dependencias (ADR-011 §4): una ejecución sin agente, sin credencial ni entrada.
 * Su salida es código del repo: el trabajador nunca la lee como eventos.
 */
const install = z.strictObject({
  type: z.literal("install"),
  sessionId: z.string().min(1),
  spec: spec.extend({ credentials: z.tuple([]) }),
  workspacesRoot: z.string(),
  runtimePaths: z.array(z.string()),
  argv: z.array(z.string()).min(1),
});

/** Todo lo que acepta el trabajador: la sesión del agente, la instalación y la cancelación. */
export const WorkerInput = z.discriminatedUnion("type", [session, install, cancel]);

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
    /**
     * Por qué paró el agente. Texto libre a propósito: un código fuera de FAILURE_REASONS no debe
     * invalidar el mensaje entero; el daemon lo normaliza a `agent_failed`.
     */
    failureReason: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("heartbeat") }),
  /** Mensaje fijo, nunca un eco de lo recibido: lo recibido puede llevar la credencial. */
  z.strictObject({ type: z.literal("error"), code: z.enum(["invalid_message", "busy"]) }),
]);

export type ToWorker = z.infer<typeof ToWorker>;
export type SessionOrder = Extract<ToWorker, { type: "session" }>;
export type FromWorker = z.infer<typeof FromWorker>;
export type WorkerInput = z.infer<typeof WorkerInput>;
export type InstallOrder = Extract<WorkerInput, { type: "install" }>;

export const encodeLine = (message: WorkerInput | FromWorker): string =>
  `${JSON.stringify(message)}\n`;
