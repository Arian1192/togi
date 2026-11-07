import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SOURCE = join(import.meta.dirname, "release.ts");

/**
 * La estructura real de `togi install`: releases/<etiqueta>/packages/daemon/src/main.ts con RELEASE en
 * releases/<etiqueta>, bajo una carpeta con espacio (Application Support). El «main.ts» es mínimo y
 * usa una copia de release.ts en su sitio, que es lo único que calcula dónde está RELEASE.
 */
function installation(support: string, tag = "v0.2.0") {
  const dir = join(support, "togi", "releases", tag);
  const src = join(dir, "packages", "daemon", "src");
  mkdirSync(join(src, "config"), { recursive: true });
  copyFileSync(SOURCE, join(src, "config", "release.ts"));
  writeFileSync(join(dir, "RELEASE"), `${JSON.stringify({ tag, commit: COMMIT })}\n`);
  writeFileSync(
    join(src, "main.ts"),
    [
      'import { CODE_ROOT, readRelease, releaseInfo } from "./config/release.ts";',
      "console.log(JSON.stringify({ root: CODE_ROOT, release: readRelease(), info: releaseInfo() }));",
    ].join("\n"),
  );
  return { dir, main: join(src, "main.ts") };
}

function runMain(main: string) {
  return JSON.parse(execFileSync(process.execPath, [main], { encoding: "utf8" })) as {
    root: string;
    release: { tag: string; commit: string } | null;
    info: { release: string; commit?: string };
  };
}

for (const support of ["Application Support", "a b#c%20é", "sin-espacios"]) {
  test(`el daemon instalado en «${support}» encuentra su RELEASE`, () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "togi-release-")));
    try {
      const { dir, main } = installation(join(base, support));
      const out = runMain(main);
      assert.equal(out.root, `${dir}/`, "la raíz es la instalación, sin codificar");
      assert.ok(!out.root.includes("%2") || support.includes("%20"), "sin porcentajes añadidos");
      assert.deepEqual(out.release, { tag: "v0.2.0", commit: COMMIT });
      assert.deepEqual(out.info, { release: "v0.2.0", commit: COMMIT });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
}

test("ejecutado sin RELEASE (desde el repo), releaseInfo es «dev» y no lleva commit", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "togi-release-")));
  try {
    const { dir, main } = installation(join(base, "Application Support"));
    rmSync(join(dir, "RELEASE"));
    assert.deepEqual(runMain(main).info, { release: "dev" });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
