import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { paths } from "@togi/daemon/config";
import { CliError } from "./errors.ts";
import { install, update } from "./install.ts";
import { plistPath, type Runner } from "./launchd.ts";
import { MESSAGES } from "./messages.ts";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
let root: string;
let source: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "togi-upd-ctl-"));
  const repo = join(root, "origen");
  mkdirSync(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, env: GIT_ENV, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  for (const tag of ["v1.0.0", "v2.0.0"]) {
    writeFileSync(join(repo, "a.txt"), tag);
    git("add", ".");
    git("commit", "-q", "-m", tag);
    git("tag", tag);
  }
  source = `file://${repo}`;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const IO_ERROR = "Bootstrap failed: 5: Input/output error";

interface SimOptions {
  /** Cuánto tarda macOS en quitar el servicio tras un bootout; mientras, bootstrap da el error 5. */
  removeMs?: number;
  /** Los n primeros bootstrap dan el error 5 aunque `print` ya diga que el servicio no está. */
  rejectBootstraps?: number;
  /** El primer bootstrap que llega con un plist de la versión nueva falla con este error. */
  failNewWith?: string;
  /** El servicio no desaparece nunca. */
  stuck?: boolean;
}

/** Un launchctl con memoria: lo cargado, lo que se está quitando y lo que se rechazó. git es el real. */
function simulatedLaunchd(options: SimOptions = {}) {
  let loaded = false;
  let busyUntil = 0;
  let rejects = options.rejectBootstraps ?? 0;
  let failNew = options.failNewWith;
  const sim = {
    calls: [] as string[][],
    rejectedBootstraps: 0,
    bootstraps: 0,
    get loaded() {
      return loaded;
    },
  };
  const removing = () => options.stuck === true || Date.now() < busyUntil;
  const run: Runner = async (cmd, args) => {
    if (cmd === "git") return execFileSync(cmd, args, { env: GIT_ENV, encoding: "utf8" });
    if (cmd !== "launchctl") return "";
    sim.calls.push([cmd, ...args]);
    const [verb, target, plist] = args;
    if (verb === "bootout") {
      if (!loaded) throw new Error("Boot-out failed: 3: No such process");
      loaded = false;
      busyUntil = Date.now() + (options.removeMs ?? 0);
      return "";
    }
    if (verb === "print") {
      if (loaded || removing()) return `${target} = { state = running }`;
      throw new Error("Could not find service");
    }
    if (verb === "bootstrap") {
      sim.bootstraps++;
      if (removing() || rejects > 0) {
        rejects = Math.max(0, rejects - 1);
        sim.rejectedBootstraps++;
        throw new Error(IO_ERROR);
      }
      const failure = failNew;
      if (failure !== undefined && readFileSync(plist as string, "utf8").includes("v2.0.0")) {
        failNew = undefined;
        // Un servicio que no llega a cargar deja a macOS quitándolo un rato.
        busyUntil = Date.now() + (options.removeMs ?? 0);
        throw new Error(failure);
      }
      loaded = true;
      return "";
    }
    return "";
  };
  return Object.assign(sim, { run });
}

const deps = (
  run: Runner,
  settle: { pollMs: number; limitMs: number } | undefined = { pollMs: 5, limitMs: 3000 },
) => ({
  run,
  supportDir: join(root, "support"),
  agentsDir: join(root, "agents"),
  uid: 501,
  node: "/usr/local/bin/node",
  platform: "darwin" as const,
  source,
  ...(settle === undefined ? {} : { settle }),
});
const home = () => join(root, "togi-home");
const plist = () => plistPath(join(root, "agents"));

test("update espera a que macOS quite el servicio antes de volver a cargarlo", async () => {
  const sim = simulatedLaunchd({ removeMs: 150 });
  await install(home(), "v1.0.0", deps(sim.run));
  assert.equal(sim.loaded, true);
  await update(home(), "v2.0.0", deps(sim.run));
  assert.equal(sim.loaded, true, "el daemon queda cargado");
  assert.equal(sim.rejectedBootstraps, 0, "no se pidió bootstrap mientras se quitaba");
  assert.ok(readFileSync(plist(), "utf8").includes("v2.0.0"));
  // El orden: bootout, consultas de print hasta que desaparece, y solo entonces bootstrap.
  const verbs = sim.calls.map((c) => c[1]);
  const out = verbs.lastIndexOf("bootout");
  assert.ok(verbs.slice(out + 1).includes("print"), "consultó si el servicio había desaparecido");
  assert.equal(verbs.at(-1), "bootstrap");
});

test("update reintenta el bootstrap si da el error 5 aunque print ya diga que no está", async () => {
  const sim = simulatedLaunchd({ rejectBootstraps: 3 });
  await install(home(), "v1.0.0", deps(simulatedLaunchd().run));
  const done = await update(home(), "v2.0.0", deps(sim.run));
  assert.equal(done.tag, "v2.0.0");
  assert.equal(sim.rejectedBootstraps, 3);
  assert.equal(sim.loaded, true);
});

test("la restauración también espera y reintenta, y deja el daemon en marcha", async () => {
  const sim = simulatedLaunchd({
    removeMs: 150,
    failNewWith: "Bootstrap failed: 119: Service is disabled",
  });
  await install(home(), "v1.0.0", deps(sim.run));
  await assert.rejects(update(home(), "v2.0.0", deps(sim.run)), (e) => {
    assert.ok(e instanceof CliError);
    assert.equal(e.code, "update_failed");
    assert.match(e.context.detail ?? "", /Se restauró la versión anterior/);
    return true;
  });
  assert.equal(sim.loaded, true, "el servicio anterior vuelve a estar cargado");
  assert.ok(readFileSync(plist(), "utf8").includes("v1.0.0"));
});

test("si el servicio no desaparece, respeta el tope y el error dice cómo arrancarlo a mano", async () => {
  const sim = simulatedLaunchd({ stuck: true });
  await install(home(), "v1.0.0", deps(simulatedLaunchd().run));
  const started = Date.now();
  await assert.rejects(
    update(home(), "v2.0.0", deps(sim.run, { pollMs: 5, limitMs: 200 })),
    (e) => {
      assert.ok(e instanceof CliError);
      const detail = e.context.detail ?? "";
      assert.match(detail, /No se pudo reactivar la anterior/);
      assert.ok(detail.includes(`launchctl bootstrap gui/501 ${plist()}`), detail);
      return true;
    },
  );
  assert.ok(Date.now() - started < 2500, "el tope se respeta");
  assert.ok(readFileSync(plist(), "utf8").includes("v1.0.0"), "el plist anterior sigue en disco");
});

test("el detalle del error conserva los saltos de línea", () => {
  const text = MESSAGES.update_failed?.({ detail: "falló\nSe restauró la versión anterior." }).text;
  assert.match(text ?? "", /falló\nSe restauró/);
  // Pero ningún carácter de control llega a la terminal.
  const dirty = MESSAGES.update_failed?.({ detail: "a\u001b[2Jb\nc" }).text ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: justo lo que se comprueba
  assert.doesNotMatch(dirty, /[\u0000-\u0009\u000b-\u001f\u007f]/);
});

/** Un daemon manual falso cuyo pid no es el del fichero de pid (que no existe): lo arrancó launchd. */
async function withForeignDaemon(body: () => Promise<void>) {
  const p = paths(home());
  mkdirSync(p.runDir, { recursive: true });
  writeFileSync(p.credentials, "tok\n");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ daemon: "0.0.0", schema: 11, pid: 4242, lastSeq: 0 }));
  });
  await new Promise<void>((ok) => server.listen(p.socket, ok));
  try {
    await body();
  } finally {
    server.close();
  }
}

test("update con el daemon arrancado por launchd no choca con daemon_pid_mismatch", async () => {
  const sim = simulatedLaunchd();
  await install(home(), "v1.0.0", deps(sim.run));
  await withForeignDaemon(async () => {
    assert.ok(!existsSync(paths(home()).pid), "launchd no escribe el fichero de pid");
    const done = await update(home(), "v2.0.0", deps(sim.run));
    assert.equal(done.tag, "v2.0.0");
  });
  assert.ok(readFileSync(plist(), "utf8").includes("v2.0.0"));
  assert.equal(sim.loaded, true);
});

test("sin LaunchAgent, un daemon cuyo pid no coincide sigue sin recibir ninguna señal", async () => {
  const sim = simulatedLaunchd();
  await withForeignDaemon(async () => {
    await assert.rejects(install(home(), "v1.0.0", deps(sim.run)), (e) => {
      assert.ok(e instanceof CliError);
      assert.equal(e.code, "install_failed");
      return true;
    });
  });
  assert.ok(!existsSync(plist()));
  assert.equal(sim.calls.length, 0, "no se llegó a tocar launchctl");
});
