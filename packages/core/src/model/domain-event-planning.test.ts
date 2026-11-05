import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../ports/event-store.ts";
import { EventParseError, toDomainEvent } from "./domain-event.ts";

const blob = { hash: "hmac-sha256:abc", keyId: "key_1", dataClass: "task_text" };
const started = {
  sessionId: "ses_1",
  role: "planner",
  cycle: null,
  runtime: { id: "claude-agent-sdk", version: "1.0.0" },
  model: "claude-sonnet-5-5",
  specialist: { id: "generic-planner", version: 1, hash: "sha256:abc" },
  workspaceId: null,
  prompt: { ...blob, dataClass: "prompt" },
  policy: { ...blob, dataClass: "prompt" },
};
const ended = {
  sessionId: "ses_1",
  outcome: "completed",
  usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.02, durationMs: 1500 },
  trajectoryEvents: 4,
};
const plan = {
  planVersion: 1,
  sessionId: "ses_1",
  files: [{ path: "packages/core/src/a.ts", change: "modify" }],
  newTests: ["packages/core/src/a.test.ts"],
  approach: blob,
  estimatedLines: { production: 80, tests: 120 },
  baseSha: "abc123",
};
const approve = { gate: "plan", mode: "binding", subject: { planVersion: 1 }, verdict: "approve" };
const withReason = (verdict: string) => ({
  ...approve,
  verdict,
  reason: { category: "scope", text: blob },
});

const stored = (type: string, payload: unknown): StoredEvent => ({
  seq: 7,
  stream: "task:1",
  streamVersion: 1,
  type,
  schemaVersion: 1,
  actor: { kind: "human", userId: "usr_1" },
  at: "2026-11-04T10:00:00Z",
  payload,
  prevHash: "p",
  hash: "h",
});

const rejects = (type: string, payload: unknown) =>
  assert.throws(
    () => toDomainEvent(stored(type, payload)),
    (e) => e instanceof EventParseError && e.seq === 7,
  );

const planWith = (patch: object) => ({ ...plan, ...patch });
const filePath = (path: string) => planWith({ files: [{ path, change: "add" }] });

test("convierte los eventos de planificación válidos", () => {
  const valid: [string, unknown][] = [
    ["session.started", started],
    ["session.started", { ...started, cycle: 1, workspaceId: "wsp_1" }],
    ["session.ended", ended],
    ["plan.proposed", plan],
    ["decision.recorded", approve],
    ["decision.recorded", withReason("request_changes")],
    ["decision.recorded", withReason("reject")],
  ];
  for (const [type, payload] of valid) {
    // El payload de session.ended sin motivo es v1: al leerlo se migra con failureReason: null.
    const expected =
      type === "session.ended" ? { ...(payload as object), failureReason: null } : payload;
    assert.deepEqual(toDomainEvent(stored(type, payload)).payload, expected);
  }
});

test("rechaza un campo de más en cada evento", () => {
  for (const [type, payload] of [
    ["session.started", started],
    ["session.ended", ended],
    ["plan.proposed", plan],
    ["decision.recorded", approve],
  ] as const) {
    rejects(type, { ...payload, extra: 1 });
  }
  rejects("session.started", { ...started, runtime: { ...started.runtime, extra: 1 } });
  rejects("session.ended", { ...ended, usage: { ...ended.usage, extra: 1 } });
  rejects("plan.proposed", planWith({ estimatedLines: { production: 1, tests: 1, extra: 1 } }));
});

test("rechaza un campo de menos en cada evento", () => {
  const { model: _m, ...sinModelo } = started;
  const { usage: _u, ...sinUso } = ended;
  const { baseSha: _b, ...sinBase } = plan;
  const { subject: _s, ...sinSujeto } = approve;
  rejects("session.started", sinModelo);
  rejects("session.ended", sinUso);
  rejects("plan.proposed", sinBase);
  rejects("decision.recorded", sinSujeto);
  rejects("plan.proposed", planWith({ estimatedLines: { production: 80 } }));
});

test("rechaza un valor fuera de la lista", () => {
  rejects("session.started", { ...started, role: "wizard" });
  rejects("session.started", { ...started, prompt: { ...blob, dataClass: "otra" } });
  rejects("session.ended", { ...ended, outcome: "exploded" });
  rejects("plan.proposed", planWith({ files: [{ path: "a.ts", change: "rename" }] }));
  rejects("decision.recorded", { ...approve, verdict: "maybe" });
  rejects("decision.recorded", { ...approve, gate: "review" });
  rejects("decision.recorded", { ...approve, mode: "shadow" });
});

test("rechaza cifras negativas o no enteras", () => {
  rejects("plan.proposed", planWith({ estimatedLines: { production: -1, tests: 0 } }));
  rejects("plan.proposed", planWith({ estimatedLines: { production: 1.5, tests: 0 } }));
  rejects("plan.proposed", planWith({ planVersion: 0 }));
  rejects("session.ended", { ...ended, usage: { ...ended.usage, inputTokens: -1 } });
});

test("approve no lleva motivo; request_changes y reject lo exigen", () => {
  rejects("decision.recorded", { ...approve, reason: { category: "scope", text: blob } });
  for (const verdict of ["request_changes", "reject"]) {
    const { reason: _r, ...sinMotivo } = withReason(verdict);
    rejects("decision.recorded", sinMotivo);
  }
  rejects("decision.recorded", { ...withReason("reject"), reason: "en claro" });
});

const BAD_PATHS: [string, string][] = [
  ["vacía", ""],
  ["absoluta", "/etc/passwd"],
  ["con segmento ..", "src/../../secreto"],
  ["que empieza por ..", "../fuera.ts"],
  ["con barra invertida", "src\\a.ts"],
  ["con byte nulo", "src/a\u0000.ts"],
  ["con carácter de control", "src/a\n.ts"],
  ["con DEL", "src/a\u007f.ts"],
  ["demasiado larga", `${"a/".repeat(128)}a.ts`],
];

for (const [name, path] of BAD_PATHS) {
  test(`rechaza una ruta ${name} en files y en newTests`, () => {
    rejects("plan.proposed", filePath(path));
    rejects("plan.proposed", planWith({ newTests: [path] }));
  });
}

test("acepta rutas relativas normales, también con puntos en el nombre", () => {
  const ok = filePath("packages/core/src/.eslintrc..json");
  assert.deepEqual(toDomainEvent(stored("plan.proposed", ok)).payload, ok);
});
