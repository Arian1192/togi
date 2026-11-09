import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

// El daemon lanza el trabajador solo con PATH (worker-launcher.ts): sin TMPDIR, tmpdir() dice /tmp.
// La temporal real del usuario (/var/folders/xx/yyyy, con T/ y las cachés de C/) tiene que seguir
// denegada igual. Lo encontró la prueba de ataque de la rebanada 2: un señuelo ahí se podía leer.

const SKIP = process.platform === "darwin" ? undefined : "la temporal de /var/folders es de macOS";
const CONFIG = join(import.meta.dirname, "srt-config.ts");

/** Lo que calcula userTmpDirs() en un proceso con el entorno del trabajador: solo PATH. */
function userTmpDirsWithout(env: Record<string, string>): string[] {
  const script = `import(${JSON.stringify(CONFIG)}).then((m) => console.log(JSON.stringify(m.userTmpDirs())))`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env,
    encoding: "utf8",
  });
  return JSON.parse(out) as string[];
}

const realUserTemp = () =>
  dirname(
    realpathSync(
      execFileSync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8" }).trim(),
    ),
  );

test("sin TMPDIR, como corre el trabajador, la temporal del usuario sigue denegada por su padre", {
  skip: SKIP,
}, () => {
  // tmpdir() sigue diciendo /tmp y también se deniega, como ya hacía deniedRead con /tmp.
  assert.deepEqual(userTmpDirsWithout({ PATH: process.env.PATH ?? "" }), [
    realUserTemp(),
    "/private/tmp",
  ]);
});

test("con un TMPDIR que apunta a otro sitio se deniegan los dos: la temporal real y la de TMPDIR", {
  skip: SKIP,
}, () => {
  assert.deepEqual(userTmpDirsWithout({ PATH: process.env.PATH ?? "", TMPDIR: "/tmp" }), [
    realUserTemp(),
    "/private/tmp",
  ]);
});
