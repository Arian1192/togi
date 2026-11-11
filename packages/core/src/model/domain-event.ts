import { z } from "zod";
import type { StoredEvent } from "../ports/event-store.ts";
import { ADMIN_STREAM } from "./admin.ts";
import { DATA_CLASSES } from "./blob.ts";
import { GATE_IDS, GATE_STATUSES } from "./building.ts";
import type { AdminEvent, DomainEvent, SpecialistEvent, TaskEvent } from "./events.ts";
import { AGENT_ROLES } from "./ids.ts";
import { FAILURE_REASONS, PLAN_CHANGES, SESSION_OUTCOMES } from "./planning.ts";
import {
  SPECIALIST_STREAM_PREFIX,
  SpecialistSchema,
  specialistHash,
  specialistStream,
} from "./specialist.ts";
import { REASON_CATEGORIES, RISK_LEVELS } from "./task.ts";

/** Los eventos del stream de una tarea; el resto (administración, catálogo) no mueven su vista. */
export const isTaskEvent = (event: DomainEvent): event is TaskEvent =>
  event.type !== "data.erased" && event.type !== "specialist.version_published";

/** Evento almacenado que no es un `DomainEvent` válido; `seq` identifica cuál. */
export class EventParseError extends Error {
  readonly seq: number;

  constructor(seq: number, message: string) {
    super(`evento seq ${seq}: ${message}`);
    this.name = "EventParseError";
    this.seq = seq;
  }
}

const blobRef = z.strictObject({
  hash: z.templateLiteral(["hmac-sha256:", z.string()]),
  keyId: z.string(),
  dataClass: z.enum(DATA_CLASSES),
});
const nullableBlob = blobRef.nullable();
const reason = z.strictObject({ category: z.enum(REASON_CATEGORIES), text: blobRef });
const risk = z.enum(RISK_LEVELS);

const source = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("cli") }),
  z.strictObject({
    kind: z.literal("github_issue"),
    repo: z.string(),
    number: z.number().int(),
    url: z.string(),
    untrustedBody: blobRef,
  }),
]);

/** Identificador de sesión (`ses_…`). Quien lo use como ruta debe además comprobar su contenido. */
export const SessionIdSchema = z.templateLiteral(["ses_", z.string()]);

const actor = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human"), userId: z.templateLiteral(["usr_", z.string()]) }),
  z.strictObject({
    kind: z.literal("agent"),
    sessionId: SessionIdSchema,
    role: z.enum(AGENT_ROLES),
  }),
  z.strictObject({
    kind: z.literal("system"),
    component: z.union([
      z.enum(["gates", "integrator", "merger", "catalog"]),
      z.templateLiteral(["adapter:", z.string()]),
    ]),
  }),
]);

const taskCreated = z.strictObject({
  title: blobRef,
  description: nullableBlob,
  acceptanceCriteria: nullableBlob,
  risk,
  repo: z.string(),
  baseBranch: z.string(),
  source,
});
const taskEdited = z.strictObject({
  title: blobRef.optional(),
  description: nullableBlob.optional(),
  acceptanceCriteria: nullableBlob.optional(),
});

const sessionId = SessionIdSchema;
const count = z.number().int().nonnegative();

const MAX_PATH_LENGTH = 256;
const hasControlChar = (text: string) =>
  [...text].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);

/** Ruta que escribe un agente: relativa, dentro del repo y sin caracteres que confundan. */
const repoPath = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .refine((p) => !p.startsWith("/"), "la ruta debe ser relativa")
  .refine((p) => !p.includes("\\"), "la ruta no admite barra invertida")
  .refine((p) => !hasControlChar(p), "la ruta no admite caracteres de control")
  .refine((p) => !p.split("/").includes(".."), 'la ruta no admite segmentos ".."');

const sessionStarted = z.strictObject({
  sessionId,
  role: z.enum(AGENT_ROLES),
  cycle: count.nullable(),
  runtime: z.strictObject({ id: z.string(), version: z.string() }),
  model: z.string(),
  specialist: z.strictObject({
    id: z.string(),
    version: count,
    hash: z.templateLiteral(["sha256:", z.string()]),
  }),
  workspaceId: z.templateLiteral(["wsp_", z.string()]).nullable(),
  prompt: blobRef,
  policy: blobRef,
});
// session.ended v1: sin motivo del fallo. Los eventos ya guardados lo conservan; se migran al leer.
const sessionEndedV1 = z.strictObject({
  sessionId,
  outcome: z.enum(SESSION_OUTCOMES),
  usage: z.strictObject({
    inputTokens: count,
    outputTokens: count,
    estimatedCostUsd: z.number().nonnegative(),
    durationMs: count,
  }),
  trajectoryEvents: count,
});
const sessionEnded = sessionEndedV1.extend({ failureReason: z.enum(FAILURE_REASONS).nullable() });

/**
 * Un fallo lleva siempre su motivo y una sesión completada nunca. Se exige a los eventos escritos en
 * v2 y a los comandos nuevos (el decider usa la misma regla). Un v1 migrado puede ser un fallo sin
 * motivo: no se escribió con esta regla y sigue siendo válido.
 */
export const failureReasonProblem = (e: {
  outcome: string;
  failureReason: string | null | undefined;
}): string | undefined => {
  const missing = (e.outcome === "failed" || e.outcome === "timeout") && !e.failureReason;
  if (missing) return `una sesión ${e.outcome} necesita motivo`;
  if (e.outcome === "completed" && e.failureReason) return "una sesión completada no lleva motivo";
  return undefined;
};

/** Lo que describe un plan, igual en el evento y en la salida del agente (que aún no tiene blobs). */
export const planContentShape = {
  files: z.array(z.strictObject({ path: repoPath, change: z.enum(PLAN_CHANGES) })),
  newTests: z.array(repoPath),
  estimatedLines: z.strictObject({ production: count, tests: count }),
};
const planProposed = z.strictObject({
  ...planContentShape,
  planVersion: z.number().int().positive(),
  sessionId,
  approach: blobRef,
  baseSha: z.string().min(1),
});
const decisionBase = {
  gate: z.literal("plan"),
  mode: z.literal("binding"),
  subject: z.strictObject({ planVersion: z.number().int().positive() }),
};
const decisionRecorded = z.discriminatedUnion("verdict", [
  z.strictObject({ ...decisionBase, verdict: z.literal("approve") }),
  z.strictObject({ ...decisionBase, verdict: z.literal("request_changes"), reason }),
  z.strictObject({ ...decisionBase, verdict: z.literal("reject"), reason }),
]);

// La rebanada 3 (ADR-011): copia de trabajo, entrega del builder y gates.
const cycle = z.number().int().positive();
/** Un commit de git, en hexadecimal: SHA-1 (40) o SHA-256 (64). */
const headSha = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, "no es un commit de git");
const workspaceId = z.templateLiteral(["wsp_", z.string()]);
const gateRunId = z.templateLiteral(["gr_", z.string()]);
const workspace = z.strictObject({
  workspaceId,
  kind: z.literal("clone"),
  ref: z.string().min(1),
  branch: z.string().min(1),
  baseSha: headSha,
});
/** El resumen de un gate lo escribe togi: corto y sin caracteres de control. */
const gateSummary = z
  .string()
  .max(200)
  .refine((s) => !hasControlChar(s), "el resumen no admite caracteres de control");
const gateRun = z.strictObject({
  gateRunId,
  cycle,
  headSha,
  gate: z.enum(GATE_IDS),
  status: z.enum(GATE_STATUSES),
  summary: gateSummary,
  evidence: nullableBlob,
  durationMs: count,
});

/** zod infiere `x?: T | undefined`; `exactOptionalPropertyTypes` pide añadirlo al tipo de core. */
type WithUndefined<T> = { [K in keyof T]: T[K] | undefined };

// `satisfies` solo no basta cuando todos los campos son opcionales: un campo de más o de menos en
// el esquema sigue siendo asignable. Este tipo exige además las mismas claves.
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;
type EditedPayload = Extract<TaskEvent, { type: "task.edited" }>["payload"];

// Un esquema por tipo; `satisfies` obliga a que sigan el tipo de core.
const TASK_PAYLOADS = {
  "task.created": taskCreated satisfies z.ZodType<
    Extract<TaskEvent, { type: "task.created" }>["payload"]
  >,
  "task.edited": taskEdited satisfies z.ZodType<WithUndefined<EditedPayload>>,
  "task.submitted": z.strictObject({}) satisfies z.ZodType<
    Extract<TaskEvent, { type: "task.submitted" }>["payload"]
  >,
  "plan.retry_requested": z.strictObject({}) satisfies z.ZodType<
    Extract<TaskEvent, { type: "plan.retry_requested" }>["payload"]
  >,
  "session.started": sessionStarted satisfies z.ZodType<
    Extract<TaskEvent, { type: "session.started" }>["payload"]
  >,
  "session.ended": sessionEnded satisfies z.ZodType<
    Extract<TaskEvent, { type: "session.ended" }>["payload"]
  >,
  "plan.proposed": planProposed satisfies z.ZodType<
    Extract<TaskEvent, { type: "plan.proposed" }>["payload"]
  >,
  "decision.recorded": decisionRecorded satisfies z.ZodType<
    Extract<TaskEvent, { type: "decision.recorded" }>["payload"]
  >,
  "task.rejected": z.strictObject({ reason }) satisfies z.ZodType<
    Extract<TaskEvent, { type: "task.rejected" }>["payload"]
  >,
  "task.completed": z.strictObject({ prNumber: z.number().int().positive() }) satisfies z.ZodType<
    Extract<TaskEvent, { type: "task.completed" }>["payload"]
  >,
  "workspace.created": workspace satisfies z.ZodType<
    Extract<TaskEvent, { type: "workspace.created" }>["payload"]
  >,
  "build.submitted": z.strictObject({ cycle, headSha }) satisfies z.ZodType<
    Extract<TaskEvent, { type: "build.submitted" }>["payload"]
  >,
  "gate.completed": gateRun satisfies z.ZodType<
    Extract<TaskEvent, { type: "gate.completed" }>["payload"]
  >,
  "verification.completed": z.strictObject({
    cycle,
    headSha,
    passed: z.boolean(),
  }) satisfies z.ZodType<Extract<TaskEvent, { type: "verification.completed" }>["payload"]>,
  "task.failed": z.strictObject({
    cycle,
    failedGates: z.array(gateRunId),
  }) satisfies z.ZodType<Extract<TaskEvent, { type: "task.failed" }>["payload"]>,
  "failure.classified": z.strictObject({ reason }) satisfies z.ZodType<
    Extract<TaskEvent, { type: "failure.classified" }>["payload"]
  >,
  "workspace.released": z.strictObject({ workspaceId }) satisfies z.ZodType<
    Extract<TaskEvent, { type: "workspace.released" }>["payload"]
  >,
};
const ADMIN_PAYLOADS = {
  "data.erased": z.strictObject({
    keyId: z.string(),
    taskId: z.number().int(),
    dataClass: z.enum(DATA_CLASSES),
    reason: z.string(),
  }) satisfies z.ZodType<AdminEvent["payload"]>,
};

export const taskEditedKeysMatchCore: SameKeys<z.output<typeof taskEdited>, EditedPayload> = true;

const SPECIALIST_PAYLOADS = {
  "specialist.version_published": z.strictObject({
    specialist: SpecialistSchema,
    hash: z.templateLiteral(["sha256:", z.string()]),
  }) satisfies z.ZodType<SpecialistEvent["payload"]>,
};

const PAYLOADS: Record<string, z.ZodType> = {
  ...TASK_PAYLOADS,
  ...ADMIN_PAYLOADS,
  ...SPECIALIST_PAYLOADS,
};

/** Todos los tipos de evento que existen (de tareas, administración y catálogo). */
export const EVENT_TYPES: readonly string[] = Object.keys(PAYLOADS);

/** Por qué el esquema rechazaría este payload, o `null`: el decider nunca emite un evento ilegible. */
export function payloadProblem(type: string, payload: unknown): string | null {
  const checked = PAYLOADS[type]?.safeParse(payload);
  if (checked === undefined) return `tipo desconocido "${type}"`;
  return checked.success ? null : z.prettifyError(checked.error);
}

/** Versión vigente de cada tipo (ADR-004); el resto va en 1. Un cambio de forma sube la suya y añade su migración. */
export const EVENT_SCHEMA_VERSIONS: Readonly<Record<string, number>> = { "session.ended": 2 };
export const schemaVersionOf = (type: string): number => EVENT_SCHEMA_VERSIONS[type] ?? 1;

/** Migraciones al leer: de la versión indicada a la siguiente. El log nunca se reescribe. */
const MIGRATIONS: Record<string, Record<number, (payload: unknown) => unknown>> = {
  "session.ended": {
    1: (payload) => ({ ...(sessionEndedV1.parse(payload) as object), failureReason: null }),
  },
};

const envelope = z.strictObject({
  schemaVersion: z.number().int().positive(),
  actor,
  at: z.iso.datetime(),
});

/** Convierte un evento leído del store en un `DomainEvent`, validando tipo, envoltorio y payload. */
export function toDomainEvent(stored: StoredEvent): DomainEvent {
  const payloadSchema = PAYLOADS[stored.type];
  if (payloadSchema === undefined) {
    throw new EventParseError(stored.seq, `tipo desconocido "${stored.type}"`);
  }
  const meta = envelope.safeParse({
    schemaVersion: stored.schemaVersion,
    actor: stored.actor,
    at: stored.at,
  });
  if (!meta.success) throw new EventParseError(stored.seq, z.prettifyError(meta.error));
  const current = schemaVersionOf(stored.type);
  if (meta.data.schemaVersion < 1 || meta.data.schemaVersion > current) {
    throw new EventParseError(
      stored.seq,
      `${stored.type}: schemaVersion ${meta.data.schemaVersion} no admitida (vigente: ${current})`,
    );
  }
  let migrated: unknown = stored.payload;
  try {
    for (let v = meta.data.schemaVersion; v < current; v++) {
      migrated = MIGRATIONS[stored.type]?.[v]?.(migrated);
    }
  } catch (error) {
    const why = error instanceof z.ZodError ? z.prettifyError(error) : String(error);
    throw new EventParseError(stored.seq, `${stored.type}: ${why}`);
  }
  const payload = payloadSchema.safeParse(migrated);
  if (!payload.success) {
    throw new EventParseError(stored.seq, `${stored.type}: ${z.prettifyError(payload.error)}`);
  }
  if (stored.type === "session.ended" && stored.schemaVersion === current) {
    const problem = failureReasonProblem(
      payload.data as { outcome: string; failureReason: string | null },
    );
    if (problem) throw new EventParseError(stored.seq, `${stored.type}: ${problem}`);
  }
  const published = stored.type === "specialist.version_published";
  if (published) {
    const { specialist, hash } = payload.data as SpecialistEvent["payload"];
    if (stored.stream !== specialistStream(specialist.id)) {
      throw new EventParseError(
        stored.seq,
        `${stored.type} no pertenece al stream ${stored.stream}`,
      );
    }
    if (hash !== specialistHash(specialist)) {
      throw new EventParseError(stored.seq, `${stored.type}: el hash no corresponde al contenido`);
    }
  } else if (stored.stream.startsWith(SPECIALIST_STREAM_PREFIX)) {
    throw new EventParseError(stored.seq, `${stored.type} no pertenece al stream ${stored.stream}`);
  }
  if (stored.type in ADMIN_PAYLOADS !== (stored.stream === ADMIN_STREAM)) {
    throw new EventParseError(stored.seq, `${stored.type} no pertenece al stream ${stored.stream}`);
  }
  return {
    seq: stored.seq,
    stream: stored.stream,
    streamVersion: stored.streamVersion,
    type: stored.type,
    // Migrado, tiene la forma vigente; el hash (integridad) se calcula siempre sobre lo guardado.
    schemaVersion: current,
    actor: meta.data.actor,
    at: meta.data.at,
    ...(stored.correlationId === undefined ? {} : { correlationId: stored.correlationId }),
    payload: payload.data,
  } as DomainEvent;
}
