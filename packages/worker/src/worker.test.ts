import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { FromWorker, Sandbox, SandboxResult } from "@togi/core";
import { serve } from "./worker.ts";

// Por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const SECRET = ["sk", "ant", "secreto", "de", "prueba"].join("-");
const order = (over: Record<string, unknown> = {}) => ({
  type: "session" as const,
  sessionId: "ses_1",
  spec: {
    readPaths: ["/w/repo"],
    writeDir: "/w/scratch",
    allowedDomains: ["api.example.com"],
    allowedEnv: ["PATH", "KEY"],
    credentials: [{ name: "KEY", injectDomains: ["api.example.com"] }],
    timeoutMs: 1000,
  },
  workspacesRoot: "/w",
  runtimePaths: [],
  argv: ["agent"],
  credential: { name: "KEY", secret: SECRET },
  ...over,
});

const done = (over: Partial<SandboxResult> = {}): SandboxResult => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  ...over,
});

/** Arranca el trabajador con un sandbox simulado y devuelve lo que escribe, ya como mensajes. */
function start(run: Sandbox["run"], heartbeatMs = 10_000) {
  const input = new PassThrough();
  const output = new PassThrough();
  const env: NodeJS.ProcessEnv = {};
  const raw: string[] = [];
  output.on("data", (d) => raw.push(String(d)));
  const finished = serve(input, output, { createSandbox: () => ({ run }), env, heartbeatMs });
  return {
    env,
    send: (m: unknown) => input.write(typeof m === "string" ? `${m}\n` : `${JSON.stringify(m)}\n`),
    /** Cierra la entrada cuando ya ha llegado el resultado: cerrarla antes cancela la sesión. */
    end: async () => {
      while (!raw.join("").includes('"type":"result"')) await tick(5);
      input.end();
    },
    /** Cierra la entrada ya: cancela la sesión en curso. */
    close: () => input.end(),
    finished,
    raw: () => raw.join(""),
    messages: () =>
      raw
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as FromWorker),
  };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test("una sesión completa: eventos de la salida del agente y un resultado", async () => {
  const stdout = [
    JSON.stringify({ kind: "tool_call", payload: { tool: "Read" } }),
    "texto que no es un mensaje",
    JSON.stringify({ kind: "inventado", payload: 1 }),
    JSON.stringify({ kind: "message", payload: "hola" }),
  ].join("\n");
  const w = start(async () => done({ stdout }));
  w.send(order());
  w.end();
  await w.finished;
  const m = w.messages();
  assert.deepEqual(
    m.filter((x) => x.type === "event").map((x) => (x as { kind: string }).kind),
    ["tool_call", "message"],
  );
  const result = m.at(-1);
  assert.equal(result?.type, "result");
  assert.equal((result as { outcome: string }).outcome, "completed");
});

test("el resultado distingue timeout, fallo y cancelación", async () => {
  const cases: [Partial<SandboxResult>, string][] = [
    [{ timedOut: true, exitCode: null }, "timeout"],
    [{ exitCode: 3 }, "failed"],
  ];
  for (const [result, outcome] of cases) {
    const w = start(async () => done(result));
    w.send(order({ credential: null }));
    w.end();
    await w.finished;
    assert.equal((w.messages().at(-1) as { outcome: string }).outcome, outcome);
  }
  const w = start(
    (_s, _a, _i, signal) =>
      new Promise((resolve) =>
        signal?.addEventListener("abort", () => resolve(done({ exitCode: null }))),
      ),
  );
  w.send(order({ credential: null }));
  await tick();
  w.send({ type: "cancel" });
  w.end();
  await w.finished;
  assert.equal((w.messages().at(-1) as { outcome: string }).outcome, "cancelled");
});

test("la credencial está en el entorno solo durante la ejecución y nunca en la salida", async () => {
  let seen: string | undefined;
  const w = start(async () => {
    seen = w.env.KEY;
    return done({ stdout: JSON.stringify({ kind: "message", payload: "ok" }) });
  });
  w.send(order());
  w.end();
  await w.finished;
  assert.equal(seen, SECRET);
  assert.equal(w.env.KEY, undefined);
  assert.ok(!w.raw().includes(SECRET));
});

test("si el sandbox falla, el entorno se limpia y el error no lleva la credencial", async () => {
  const w = start(async () => {
    throw new Error(`falló con ${SECRET}`);
  });
  w.send(order());
  w.end();
  await w.finished;
  assert.equal(w.env.KEY, undefined);
  assert.equal((w.messages().at(-1) as { outcome: string }).outcome, "failed");
  assert.ok(!w.raw().includes(SECRET));
});

test("un mensaje no válido da un error fijo, sin eco, y el trabajador sigue vivo", async () => {
  const w = start(async () => done());
  w.send(`{"type":"session","credential":{"secret":"${SECRET}"`);
  w.send(order({ extra: SECRET }));
  w.send(order({ credential: null }));
  w.end();
  await w.finished;
  const m = w.messages();
  assert.deepEqual(m.slice(0, 2), [
    { type: "error", code: "invalid_message" },
    { type: "error", code: "invalid_message" },
  ]);
  assert.equal(m.at(-1)?.type, "result");
  assert.ok(!w.raw().includes(SECRET));
});

test("una segunda sesión mientras hay una en curso es busy", async () => {
  let release: () => void = () => {};
  const w = start(() => new Promise((r) => (release = () => r(done()))));
  w.send(order({ credential: null }));
  await tick();
  w.send(order({ sessionId: "ses_2", credential: null }));
  await tick();
  release();
  w.end();
  await w.finished;
  assert.deepEqual(
    w.messages().filter((x) => x.type === "error"),
    [{ type: "error", code: "busy" }],
  );
});

test("mientras hay una sesión envía latidos", async () => {
  let release: () => void = () => {};
  const w = start(() => new Promise((r) => (release = () => r(done()))), 10);
  w.send(order({ credential: null }));
  await tick(80);
  release();
  w.end();
  await w.finished;
  assert.ok(w.messages().filter((x) => x.type === "heartbeat").length >= 2);
});

test("al cerrarse la entrada, cancela la sesión en curso y termina", async () => {
  let aborted = false;
  const w = start(
    (_s, _a, _i, signal) =>
      new Promise((resolve) =>
        signal?.addEventListener("abort", () => {
          aborted = true;
          resolve(done({ exitCode: null }));
        }),
      ),
  );
  w.send(order({ credential: null }));
  await tick();
  w.close();
  await w.finished;
  assert.equal(aborted, true);
  assert.equal((w.messages().at(-1) as { outcome: string }).outcome, "cancelled");
});

const partial = [
  JSON.stringify({ kind: "tool_call", payload: { tool: "Read" } }),
  JSON.stringify({ kind: "message", payload: "a medias" }),
].join("\n");

test("por tope de tiempo, los eventos que el agente ya escribió llegan antes del resultado", async () => {
  const w = start(async () => done({ stdout: partial, timedOut: true, exitCode: null }));
  w.send(order({ credential: null }));
  w.end();
  await w.finished;
  const m = w.messages();
  assert.deepEqual(
    m.filter((x) => x.type === "event").map((x) => (x as { kind: string }).kind),
    ["tool_call", "message"],
  );
  assert.equal((m.at(-1) as { outcome: string }).outcome, "timeout");
});

test("por cancelación, los eventos que el agente ya escribió llegan antes del resultado", async () => {
  const w = start(
    (_s, _a, _i, signal) =>
      new Promise((resolve) =>
        signal?.addEventListener("abort", () => resolve(done({ stdout: partial, exitCode: null }))),
      ),
  );
  w.send(order({ credential: null }));
  await tick();
  w.send({ type: "cancel" });
  w.end();
  await w.finished;
  const m = w.messages();
  assert.deepEqual(
    m.filter((x) => x.type === "event").map((x) => (x as { kind: string }).kind),
    ["tool_call", "message"],
  );
  assert.equal((m.at(-1) as { outcome: string }).outcome, "cancelled");
});
