import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Reaper } from "./reap.ts";

const skip = process.platform === "darwin" ? undefined : "Reaper solo funciona en macOS";
const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-marks-")));
const runDir = join(root, "run");
const scratch = join(root, "scratch");
mkdirSync(scratch, { recursive: true });
test.after(() => rmSync(root, { recursive: true, force: true }));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reaper = () => new Reaper(scratch, "darwin", runDir);
const links = () => readdirSync(runDir).filter((f) => f.startsWith(".togi-run-"));

/**
 * Un escapado que es un binario de Apple (`sleep`: ps -E no ve su entorno) con la marca heredada,
 * cuya ejecución terminó sin barrer (el trabajador murió con SIGKILL).
 */
function orphan(old: Reaper): number {
  const child = spawn("/bin/sleep", ["60"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore", old.fd],
  });
  child.unref();
  closeSync(old.fd); // el trabajador muerto ya no la tiene
  assert.ok(child.pid && alive(child.pid));
  return child.pid;
}
const sweptBy = async (pid: number) => {
  await reaper().begin();
  await wait(200);
  assert.equal(alive(pid), false, "el escapado sigue vivo");
};

test("la marca se registra en runDir con un enlace duro", { skip }, () => {
  const r = reaper();
  assert.ok(links().some((f) => f.includes(r.tag)));
  closeSync(r.fd);
});

test("un escapado de Apple de un trabajador muerto, con otro PID, muere al empezar", {
  skip,
}, async () => {
  const dead = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => dead.on("close", resolve));
  const old = reaper();
  const pid = orphan(old);
  // El dueño de la marca pasa a ser un PID que ya no existe, como el de un trabajador muerto.
  const name = links().find((f) => f.includes(old.tag)) as string;
  renameSync(join(runDir, name), join(runDir, name.replace(`-${process.pid}-`, `-${dead.pid}-`)));
  await sweptBy(pid);
  assert.equal(
    links().filter((f) => f.includes(`-${dead.pid}-`)).length,
    0,
    "el enlace no se borró",
  );
});

test("si el agente borra su nombre de la marca en scratch, se encuentra por el enlace", {
  skip,
}, async () => {
  const old = reaper();
  const pid = orphan(old);
  for (const f of readdirSync(scratch)) rmSync(join(scratch, f), { force: true });
  await sweptBy(pid);
});

test("la marca de un trabajador vivo ajeno no se toca", { skip }, async () => {
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const old = reaper();
  const pid = orphan(old);
  const name = links().find((f) => f.includes(old.tag)) as string;
  const foreign = join(runDir, name.replace(`-${process.pid}-`, `-${other.pid}-`));
  renameSync(join(runDir, name), foreign);
  await reaper().begin();
  await wait(200);
  assert.ok(alive(pid), "se mató a un trabajador vivo ajeno");
  assert.ok(existsSync(foreign));
  process.kill(pid, "SIGKILL");
  other.kill("SIGKILL");
});

test("sin runDir, Reaper falla en vez de seguir sin marca persistente", { skip }, () => {
  assert.throws(() => new Reaper(scratch, "darwin"), /runDir/);
});

test("la marca de entorno se acota a su run/: otro TOGI_HOME no barre a los escapados de este", {
  skip,
}, async () => {
  const mine = reaper();
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    detached: true,
    stdio: "ignore",
    env: { PATH: process.env.PATH ?? "", ...mine.env },
  });
  child.unref();
  closeSync(mine.fd);
  await wait(300);
  const other = join(root, "otro-togi-home", "run");
  await new Reaper(scratch, "darwin", other).begin();
  await wait(200);
  assert.ok(child.pid && alive(child.pid), "otro TOGI_HOME mató a un escapado ajeno");
  await sweptBy(child.pid); // el mismo run/ sí lo barre
});
