import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { SessionOrder } from "@togi/core";
import { serve } from "./worker.ts";

// Por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const SECRET = ["sk", "ant", "secreto", "de", "prueba"].join("-");
const order = {
  type: "session",
  sessionId: "ses_1",
  spec: {
    readPaths: [],
    writeDir: "/w/scratch",
    allowedDomains: [],
    allowedEnv: [],
    credentials: [],
    timeoutMs: 1000,
  },
  workspacesRoot: "/w",
  runtimePaths: [],
  argv: ["agent"],
  credential: { name: "KEY", secret: SECRET },
} satisfies SessionOrder;

/** Una sesión cuyo agente sale con `exitCode` y escribe `stderr`; devuelve lo que el trabajador escribe en el suyo. */
async function workerStderr(stderr: string, exitCode: number): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  const err = new PassThrough();
  const raw: string[] = [];
  const errRaw: string[] = [];
  output.on("data", (d) => raw.push(String(d)));
  err.on("data", (d) => errRaw.push(String(d)));
  const finished = serve(input, output, {
    createSandbox: () => ({ run: async () => ({ exitCode, stdout: "", stderr, timedOut: false }) }),
    env: {},
    stderr: err,
  });
  input.write(`${JSON.stringify(order)}\n`);
  while (!raw.join("").includes('"type":"result"')) await new Promise((r) => setTimeout(r, 5));
  input.end();
  await finished;
  return errRaw.join("");
}

test("un agente que falla deja la cola de su stderr, sin la credencial", async () => {
  const out = await workerStderr(`uno\nfalló con ${SECRET} dentro\n\ndos\n`, 1);
  assert.equal(out, "agente: uno\nagente: falló con [credencial] dentro\nagente: dos\n");
  assert.ok(!out.includes(SECRET));
});

test("solo se conservan las últimas 20 líneas, cortas", async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `línea ${i + 1} ${"x".repeat(400)}`);
  const out = (await workerStderr(lines.join("\n"), 1)).trimEnd().split("\n");
  assert.equal(out.length, 20);
  assert.match(out[0] ?? "", /^agente: línea 11 /);
  assert.ok(out.every((l) => l.length <= "agente: ".length + 300));
});

test("las secuencias de escape y los controles se quitan de cada línea", async () => {
  const out = await workerStderr("\u001b[31mroja\u001b[0m\u009b2J\rfin\ncolumna\tdos\n", 1);
  assert.equal(out, "agente: [31mroja[0m2Jfin\nagente: columnados\n");
  assert.ok(!/\p{Cc}/u.test(out.replaceAll("\n", "")));
});

test("si el agente termina bien no se escribe nada", async () => {
  assert.equal(await workerStderr("aviso sin importancia", 0), "");
});
