import { z } from "zod";
import type { StoredEvent } from "../ports/event-store.ts";
import { ADMIN_STREAM } from "./admin.ts";
import { DATA_CLASSES } from "./blob.ts";
import type { AdminEvent, DomainEvent, TaskEvent } from "./events.ts";
import { AGENT_ROLES } from "./ids.ts";
import { PLAN_CHANGES, SESSION_OUTCOMES } from "./planning.ts";
import { REASON_CATEGORIES, RISK_LEVELS } from "./task.ts";

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

const actor = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human"), userId: z.templateLiteral(["usr_", z.string()]) }),
  z.strictObject({
    kind: z.literal("agent"),
    sessionId: z.templateLiteral(["ses_", z.string()]),
    role: z.enum(AGENT_ROLES),
  }),
  z.strictObject({
    kind: z.literal("system"),
    component: z.union([
      z.enum(["gates", "integrator", "merger"]),
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

const sessionId = z.templateLiteral(["ses_", z.string()]);
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
const sessionEnded = z.strictObject({
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
const planProposed = z.strictObject({
  planVersion: z.number().int().positive(),
  sessionId,
  files: z.array(z.strictObject({ path: repoPath, change: z.enum(PLAN_CHANGES) })),
  newTests: z.array(repoPath),
  approach: blobRef,
  estimatedLines: z.strictObject({ production: count, tests: count }),
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

const PAYLOADS: Record<string, z.ZodType> = { ...TASK_PAYLOADS, ...ADMIN_PAYLOADS };

const envelope = z.strictObject({ schemaVersion: z.literal(1), actor, at: z.iso.datetime() });

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
  const payload = payloadSchema.safeParse(stored.payload);
  if (!payload.success) {
    throw new EventParseError(stored.seq, `${stored.type}: ${z.prettifyError(payload.error)}`);
  }
  if (stored.type in ADMIN_PAYLOADS !== (stored.stream === ADMIN_STREAM)) {
    throw new EventParseError(stored.seq, `${stored.type} no pertenece al stream ${stored.stream}`);
  }
  return {
    seq: stored.seq,
    stream: stored.stream,
    streamVersion: stored.streamVersion,
    type: stored.type,
    schemaVersion: meta.data.schemaVersion,
    actor: meta.data.actor,
    at: meta.data.at,
    ...(stored.correlationId === undefined ? {} : { correlationId: stored.correlationId }),
    payload: payload.data,
  } as DomainEvent;
}
