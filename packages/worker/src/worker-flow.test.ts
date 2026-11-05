import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeLine, FromWorker } from "@togi/core";
import { scanArgv } from "./sandbox/testing/probes.ts";

// Construido por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const SECRET = ["sk", "ant", "valor", "real", "de", "prueba"].join("-");
const KEY = "TOGI_FLOW_KEY";
const API = "api.anthropic.com";

test("flujo completo con srt: el agente ve el marcador y nunca el valor", {
  skip: process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS",
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-flow-")));
  const workspaces = join(root, "togi", "workspaces");
  const repo = join(workspaces, "s1", "repo");
  const scratch = join(workspaces, "s1", "scratch");
  mkdirSync(repo, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  try {
    // El agente devuelve lo que ve en la variable, como un evento de trayectoria.
    const agent = `printf '{"kind":"message","payload":{"marker":"%s"}}\\n' "$${KEY}"`;
    const order = {
      type: "session",
      sessionId: "ses_flow",
      spec: {
        readPaths: [repo],
        writeDir: scratch,
        allowedDomains: [API],
        allowedEnv: ["PATH", KEY],
        credentials: [{ name: KEY, injectDomains: [API] }],
        timeoutMs: 20_000,
      },
      workspacesRoot: workspaces,
      runtimePaths: [],
      argv: ["/bin/sh", "-c", agent],
      credential: { name: KEY, secret: SECRET },
    } as const;

    const env = { PATH: process.env.PATH ?? "" };
    const main = join(import.meta.dirname, "main.ts");
    const worker = spawn(process.execPath, [main], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    worker.stdout.on("data", (d) => {
      out += d;
    });
    worker.stderr.on("data", (d) => {
      err += d;
    });
    const closed = new Promise((resolve) => worker.on("close", resolve));
    worker.stdin.write(encodeLine(order as never));
    // Cerrar la entrada cancela la sesión: se cierra cuando ya ha llegado el resultado.
    for (let i = 0; i < 400 && !out.includes('"type":"result"'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    worker.stdin.end();
    await closed;

    const messages = out
      .split("\n")
      .filter(Boolean)
      .map((l) => FromWorker.parse(JSON.parse(l)));
    const event = messages.find((m) => m.type === "event");
    const marker = (event as { payload: { marker: string } }).payload.marker;
    assert.ok(marker.length > 0, "el agente no recibió ningún marcador");
    assert.notEqual(marker, SECRET);
    assert.equal((messages.at(-1) as { outcome: string }).outcome, "completed");
    // El valor real solo viajó en el mensaje de sesión: ni argumentos, ni entorno, ni salidas.
    for (const where of [out, err, worker.spawnargs.join(" "), JSON.stringify(env)]) {
      assert.ok(!where.includes(SECRET));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Arranca el trabajador real con una orden y devuelve sus mensajes cuando llega el resultado. */
async function runFlow(
  agent: string[],
  over: { timeoutMs: number; cancelAfterMs?: number },
): Promise<{ messages: FromWorker[]; out: string; err: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-flow-")));
  const workspaces = join(root, "togi", "workspaces");
  const repo = join(workspaces, "s1", "repo");
  const scratch = join(workspaces, "s1", "scratch");
  mkdirSync(repo, { recursive: true });
  mkdirSync(scratch, { recursive: true });
  try {
    const order = {
      type: "session",
      sessionId: "ses_flow",
      spec: {
        readPaths: [repo],
        writeDir: scratch,
        allowedDomains: [API],
        allowedEnv: ["PATH", KEY],
        credentials: [{ name: KEY, injectDomains: [API] }],
        timeoutMs: over.timeoutMs,
      },
      workspacesRoot: workspaces,
      runtimePaths: [],
      argv: agent,
      credential: { name: KEY, secret: SECRET },
    };
    const main = join(import.meta.dirname, "main.ts");
    const env = { PATH: process.env.PATH ?? "" };
    const worker = spawn(process.execPath, [main], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    worker.stdout.on("data", (d) => {
      out += d;
    });
    worker.stderr.on("data", (d) => {
      err += d;
    });
    const closed = new Promise((resolve) => worker.on("close", resolve));
    worker.stdin.write(encodeLine(order as never));
    if (over.cancelAfterMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, over.cancelAfterMs));
      worker.stdin.write(encodeLine({ type: "cancel" }));
    }
    for (let i = 0; i < 600 && !out.includes('"type":"result"'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    worker.stdin.end();
    await closed;
    const messages = out
      .split("\n")
      .filter(Boolean)
      .map((l) => FromWorker.parse(JSON.parse(l)));
    return { messages, out, err };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const darwinOnly = {
  skip: process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS",
};
const hangsAfterEvent = `printf '{"kind":"message","payload":"antes"}\\n'; exec sleep 60`;

test("flujo completo: por tope de tiempo llegan los eventos ya escritos", darwinOnly, async () => {
  const { messages } = await runFlow(["/bin/sh", "-c", hangsAfterEvent], { timeoutMs: 1500 });
  assert.deepEqual(
    messages.filter((m) => m.type === "event").map((m) => (m as { payload: unknown }).payload),
    ["antes"],
  );
  assert.equal((messages.at(-1) as { outcome: string }).outcome, "timeout");
});

test("flujo completo: por cancelación llegan los eventos ya escritos", darwinOnly, async () => {
  const { messages } = await runFlow(["/bin/sh", "-c", hangsAfterEvent], {
    timeoutMs: 30_000,
    cancelAfterMs: 2500,
  });
  assert.deepEqual(
    messages.filter((m) => m.type === "event").map((m) => (m as { payload: unknown }).payload),
    ["antes"],
  );
  assert.equal((messages.at(-1) as { outcome: string }).outcome, "cancelled");
});

test(
  "flujo completo: el barrido de PID no encuentra el valor real en ningún entorno",
  darwinOnly,
  async () => {
    // La sonda credencial-entorno-ajeno: imprime DENIED, ALLOWED o ERROR; el agente lo reenvía.
    const script = `r=$("$@"); printf '{"kind":"message","payload":"%s"}\\n' "$r"`;
    const agent = ["/bin/sh", "-c", script, "sh", ...scanArgv(`${KEY}=${SECRET}`)];
    const { messages, out, err } = await runFlow(agent, { timeoutMs: 60_000 });
    const verdicts = messages
      .filter((m) => m.type === "event")
      .map((m) => (m as { payload: string }).payload);
    assert.deepEqual(verdicts, ["DENIED"]);
    assert.equal((messages.at(-1) as { outcome: string }).outcome, "completed");
    assert.ok(!out.includes(SECRET) && !err.includes(SECRET));
  },
);
