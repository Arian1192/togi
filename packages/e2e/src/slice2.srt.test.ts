import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { runCli } from "../../cli/src/testing/run-cli.ts";
import type { Notification } from "../../daemon/src/notify/notifier.ts";
import { ClaudePlanner } from "../../daemon/src/orchestrator/claude-planner.ts";
import type { PlannerContext } from "../../daemon/src/orchestrator/claude-planner-factory.ts";
import { claudeRuntime } from "../../daemon/src/orchestrator/runtime-paths.ts";
import { startDaemon } from "../../daemon/src/start.ts";
import { createWorkerLauncher } from "../../daemon/src/worker/worker-launcher.ts";
import { claudeAgentSdkDeclaration } from "../../worker/src/adapters/claude-agent-sdk/declaration.ts";

// Rebanada 2 de extremo a extremo (PR 17): la CLI real contra un daemon real cuyo planificador lanza
// un agente falso dentro del sandbox real. El daemon corre en este proceso porque el que arranca
// `togi daemon start` usa el planificador de producción, que no admite otro agente, y cambiarlo
// sería código de producción. La CLI va por el socket y el token del home, como siempre.

const SKIP = process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS";
const WORKER = join(import.meta.dirname, "..", "..", "worker");
const AGENT_DIR = join(import.meta.dirname, "testing");

let root: string;
let home: string;
let clone: string;
let hangFlag: string;
let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;
const notifications: Notification[] = [];

const togi = (...args: string[]) => runCli(args, home);
const ok = async (...args: string[]) => {
  const r = await togi(...args);
  assert.equal(r.code, 0, `togi ${args.join(" ")}: ${r.stdout}${r.stderr}`);
  return r.stdout;
};
const stateOf = async (n: number) => (await ok("task", "show", String(n))).split("\n")[1] ?? "";

/** Espera a que la tarea salga de planning; el planificador trabaja en segundo plano. */
async function settled(n: number, ms = 60_000): Promise<string> {
  const end = Date.now() + ms;
  for (;;) {
    const line = await stateOf(n);
    if (!/^\s*planning\b/.test(line) || Date.now() > end) return line;
    await new Promise((r) => setTimeout(r, 300));
  }
}

const newTask = async (title: string, description = "Exportar promociones a CSV.") =>
  JSON.parse(
    await ok(
      "task",
      "new",
      title,
      "--risk",
      "low",
      "--repo",
      "acme/app",
      "--base",
      "main",
      "--description",
      description,
      "--criteria",
      "Descarga un .csv",
      "--json",
    ),
  ).number as number;

function planner(context: PlannerContext): ClaudePlanner {
  const runtime = claudeRuntime(WORKER);
  return new ClaudePlanner({
    db: context.db,
    store: context.store,
    readText: context.readText,
    home: context.home,
    credentials: {
      status: async () => "api-key" as const,
      read: async () => ({ mode: "api-key" as const, envName: "ANTHROPIC_API_KEY", secret: "x" }),
    },
    launcher: createWorkerLauncher({
      agentEvents: context.agentEvents,
      workerEntry: join(WORKER, "src", "main.ts"),
      scrub: context.scrub,
      graceMs: 500,
    }),
    declaration: claudeAgentSdkDeclaration,
    agentEntry: join(AGENT_DIR, "slice2-agent.mjs"),
    runtime: { id: "claude-agent-sdk", version: runtime.sdkVersion },
    // La carpeta de la marca de MODE:hang-once se reabre a la lectura: el agente solo mira si existe.
    runtimePaths: [dirname(realpathSync(process.execPath)), AGENT_DIR, dirname(hangFlag)],
    executable: runtime.executable,
    maxCostUsd: 1,
  });
}

before(async () => {
  if (SKIP) return;
  root = realpathSync(mkdtempSync(join(tmpdir(), "togi-e2e2-")));
  home = join(root, "home");
  clone = join(root, "clone");
  hangFlag = join(root, "flag", "hang");
  mkdirSync(dirname(hangFlag), { recursive: true });
  mkdirSync(clone);
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: clone });
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", "git@github.com:acme/app.git");
  writeFileSync(join(clone, "README.md"), "hola desde el repo");
  git("add", ".");
  git("commit", "-q", "-m", "uno");
  daemon = await startDaemon(
    home,
    { ...process.env, TOGI_HOME: home, TOGI_KEYCHAIN: "file" },
    { planner, notify: (n) => notifications.push(n) },
  );
});

after(async () => {
  if (SKIP) return;
  await daemon?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("rebanada 2, de extremo a extremo", { skip: SKIP, concurrency: false }, () => {
  it("registrar, crear, enviar, pedir cambios y aprobar la versión 2", async () => {
    assert.match(await ok("daemon", "status"), /Daemon en marcha/);
    await ok("repo", "add", "acme/app", "--path", clone);
    const n = await newTask("Exportar CSV");
    await ok("task", "submit", String(n));

    assert.match(await settled(n), /plan_review/);
    const v1 = await ok("plan", "show", String(n));
    assert.match(v1, /versión 1/);
    assert.match(v1, /readme=hola desde el repo/);
    assert.ok(
      notifications.some((x) => x.message.startsWith(`#${n} `) && /plan listo/.test(x.title)),
    );

    await ok("plan", "request-changes", String(n), "--category", "scope", "--reason", "PIDE-V2");
    assert.match(await settled(n), /plan_review/);
    const v2 = await ok("plan", "show", String(n));
    assert.match(v2, /versión 2/);
    assert.match(v2, /versión 2: lo que pidió el humano/);
    assert.match(await ok("plan", "show", String(n), "--version", "1"), /versión 1/);

    assert.match(await ok("plan", "approve", String(n)), /building/);
    assert.match(await stateOf(n), /building/);
  });

  it("un plan por encima de los límites avisa y no se puede aprobar", async () => {
    const n = await newTask("MODE:over-limit");
    await ok("task", "submit", String(n));
    assert.match(await settled(n), /plan_review/);
    assert.match(await ok("plan", "show", String(n)), /límites/);
    const approve = await togi("plan", "approve", String(n));
    assert.notEqual(approve.code, 0);
    assert.match(await stateOf(n), /plan_review/);
  });

  it("si el trabajador muere, togi reintenta solo y el plan llega sin avisar del fallo", async () => {
    writeFileSync(hangFlag, "");
    const n = await newTask("MODE:hang-once", `Colgarse una vez. HANG:${hangFlag}`);
    await ok("task", "submit", String(n));
    // El agente se cuelga; se mata al trabajador, que es hijo de este proceso (nunca el de otro test).
    let worker: number | undefined;
    for (let i = 0; i < 100 && worker === undefined; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const pids = spawnedWorkers();
      worker = pids[0];
    }
    assert.ok(worker, "no apareció el trabajador");
    rmSync(hangFlag);
    process.kill(worker, "SIGKILL");

    assert.match(await settled(n), /plan_review/);
    // Lo que pasó, en el log: dos sesiones, y la primera acabó porque murió el trabajador.
    const ended = (daemon?.db
      .prepare(
        "SELECT json_extract(payload, '$.failureReason') AS reason FROM events WHERE stream = ? AND type = 'session.ended' ORDER BY seq",
      )
      .all(`task:${n}`) ?? []) as { reason: string | null }[];
    assert.deepEqual(
      ended.map((e) => e.reason),
      ["worker_died", null],
    );
    const mine = notifications.filter((x) => x.message.startsWith(`#${n} `));
    assert.ok(
      mine.some((x) => /plan listo/.test(x.title)),
      "falta el aviso de plan listo",
    );
    assert.ok(!mine.some((x) => /fallida/.test(x.title)), "no debía avisar del fallo");
  });
});

/** Los trabajadores que ha lanzado este proceso (hijos directos con el main.ts del trabajador). */
function spawnedWorkers(): number[] {
  try {
    return execFileSync("pgrep", ["-P", String(process.pid), "-f", "worker/src/main.ts"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}
