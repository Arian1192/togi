import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import type { SessionOrder } from "@togi/core";
import type Database from "better-sqlite3";
import { scanArgv } from "../../../worker/src/sandbox/testing/probes.ts";
import { FileBlobStore } from "../blobs/file-blob-store.ts";
import { RedactingBlobStore } from "../blobs/redacting-blob-store.ts";
import { DataKeyring } from "../keys/data-keys.ts";
import { loadOrCreateMasterKey } from "../keys/master-key.ts";
import { selectKeychain } from "../keys/select-keychain.ts";
import { openEventDatabase } from "../store/database.ts";
import { AgentEventStore } from "../trajectory/agent-event-store.ts";
import { createWorkerLauncher } from "./worker-launcher.ts";

const skip = process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS";
// Construido por partes: ningún detector de secretos lo ve como una clave en el código fuente.
const SECRET = ["sk", "ant", "valor", "real", "de", "prueba"].join("-");
const KEY = "TOGI_LAUNCH_KEY";
const API = "api.anthropic.com";
const ENTRY = join(import.meta.dirname, "..", "..", "..", "worker", "src", "main.ts");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

let root: string;
let db: Database.Database;
let blobs: RedactingBlobStore;
let agentEvents: AgentEventStore;
beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-launch-srt-")));
  mkdirSync(join(root, "togi", "workspaces", "s1", "repo"), { recursive: true });
  mkdirSync(join(root, "togi", "workspaces", "s1", "scratch"), { recursive: true });
  db = openEventDatabase(join(root, "db.sqlite"));
  const key = await loadOrCreateMasterKey(
    selectKeychain({ home: root, env: { TOGI_KEYCHAIN: "file" } }),
  );
  blobs = new RedactingBlobStore(new FileBlobStore(join(root, "blobs"), new DataKeyring(db, key)));
  agentEvents = new AgentEventStore(db, blobs);
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const work = () => join(root, "togi", "workspaces", "s1");
const order = (sessionId: string, argv: string[], timeoutMs = 30_000): SessionOrder => ({
  type: "session",
  sessionId,
  spec: {
    readPaths: [join(work(), "repo")],
    writeDir: join(work(), "scratch"),
    allowedDomains: [API],
    allowedEnv: ["PATH", KEY],
    credentials: [{ name: KEY, injectDomains: [API] }],
    timeoutMs,
  },
  workspacesRoot: join(root, "togi", "workspaces"),
  runtimePaths: [],
  argv,
  credential: { name: KEY, secret: SECRET },
});
/** El agente ejecuta `argv` y devuelve su salida como un evento de trayectoria. */
const reporting = (argv: string[]) => [
  "/bin/sh",
  "-c",
  `r=$("$@"); printf '{"kind":"message","payload":{"out":"%s"}}\\n' "$r"`,
  "sh",
  ...argv,
];
async function firstPayload(sessionId: string): Promise<{ out: string }> {
  const [e] = agentEvents.readSession(sessionId);
  return JSON.parse(
    new TextDecoder().decode(await blobs.get(JSON.parse((e as { payload: string }).payload))),
  );
}
const scan = (sessionId: string) => order(sessionId, reporting(scanArgv(`${KEY}=${SECRET}`)));

test("barrido de PID: el entorno inicial del trabajador no contiene la credencial", {
  skip,
}, async () => {
  const launcher = createWorkerLauncher({ agentEvents, workerEntry: ENTRY });
  const r = await launcher.run(scan("ses_scan"), 1);
  assert.equal(r.outcome, "completed", r.diagnostics);
  assert.equal((await firstPayload("ses_scan")).out, "DENIED");
});

test("control positivo: con la credencial en el entorno inicial, el barrido la encuentra", {
  skip,
}, async () => {
  const env = { PATH: process.env.PATH ?? "", [KEY]: SECRET };
  const launcher = createWorkerLauncher({ agentEvents, workerEntry: ENTRY, env });
  const r = await launcher.run(scan("ses_ctl"), 1);
  assert.equal(r.outcome, "completed", r.diagnostics);
  assert.equal((await firstPayload("ses_ctl")).out, "ALLOWED");
});

/**
 * El agente se escapa con setsid ejecutando `command`. El daemon mata al trabajador con SIGKILL
 * (graceMs 0: sin dejarle limpiar) y la sesión siguiente, de 6 s, debe eliminar al escapado al empezar.
 */
async function nextSessionReapsEscaped(command: string[]) {
  const pidFile = join(work(), "scratch", "escaped.pid");
  const script = `/usr/bin/perl -MPOSIX -e 'exit 0 if fork; POSIX::setsid(); open F, ">", $ARGV[0]; print F $$; close F; exec @ARGV[1..$#ARGV]' "$@" </dev/null >/dev/null 2>&1; sleep 60`;
  const killer = createWorkerLauncher({ agentEvents, workerEntry: ENTRY, graceMs: 0 });
  const abort = new AbortController();
  const argv = ["/bin/sh", "-c", script, "sh", pidFile, ...command];
  const first = killer.run(order("ses_1", argv), 1, abort.signal);
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await wait(100);
  assert.ok(existsSync(pidFile), "el agente no llegó a escaparse");
  const escaped = Number(readFileSync(pidFile, "utf8"));
  abort.abort();
  assert.equal((await first).outcome, "cancelled");
  await wait(200);
  assert.ok(alive(escaped), "el escapado no sobrevivió al SIGKILL del trabajador");

  const launcher = createWorkerLauncher({ agentEvents, workerEntry: ENTRY });
  let finished = false;
  const second = launcher.run(order("ses_2", ["/bin/sh", "-c", "sleep 6"]), 1).finally(() => {
    finished = true;
  });
  for (let i = 0; i < 100 && alive(escaped); i++) await wait(20);
  const stillAlive = alive(escaped);
  const sessionOver = finished; // antes de esperar a la sesión
  if (stillAlive) process.kill(escaped, "SIGKILL"); // no dejar basura aunque el test falle
  await second;
  assert.equal(stillAlive, false, "el escapado sigue vivo");
  assert.equal(sessionOver, false, "murió solo al terminar la segunda sesión, no al empezar");
}

test(
  "tras SIGKILL al trabajador, la sesión siguiente elimina a un escapado que no es de Apple",
  {
    skip,
  },
  () => nextSessionReapsEscaped([process.execPath, "-e", "setTimeout(()=>{},60000)"]),
);

test(
  "tras SIGKILL al trabajador, la sesión siguiente elimina a un escapado de Apple (sleep)",
  {
    skip,
  },
  () => nextSessionReapsEscaped(["sleep", "60"]),
);
