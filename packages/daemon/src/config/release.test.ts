import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CODE_ROOT, DEV_RELEASE, RELEASE_FILE, readRelease, releaseTag } from "./release.ts";

const COMMIT = "a".repeat(40);

function withRoot(content: string | undefined, check: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "togi-release-"));
  try {
    if (content !== undefined) writeFileSync(join(root, RELEASE_FILE), content);
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("lee la etiqueta y el commit exacto del fichero RELEASE", () => {
  withRoot(JSON.stringify({ tag: "v0.3.1", commit: COMMIT }), (root) => {
    assert.deepEqual(readRelease(root), { tag: "v0.3.1", commit: COMMIT });
    assert.equal(releaseTag(root), "v0.3.1");
  });
});

test("sin fichero RELEASE devuelve «dev»", () => {
  withRoot(undefined, (root) => {
    assert.equal(readRelease(root), undefined);
    assert.equal(releaseTag(root), DEV_RELEASE);
  });
});

test("un RELEASE corrupto o con valores no válidos cuenta como «dev»", () => {
  const bad = [
    "no es json",
    JSON.stringify({ tag: "v1" }),
    JSON.stringify({ tag: "v1", commit: "abc" }),
    JSON.stringify({ tag: "-rf", commit: COMMIT }),
    JSON.stringify({ tag: "../x", commit: COMMIT }),
    JSON.stringify({ tag: "a..b", commit: COMMIT }),
    JSON.stringify({ tag: "a/b", commit: COMMIT }),
  ];
  for (const content of bad) withRoot(content, (root) => assert.equal(releaseTag(root), "dev"));
});

test("ejecutado desde el repo, la raíz del código no tiene RELEASE", () => {
  assert.equal(readRelease(CODE_ROOT), undefined);
});
