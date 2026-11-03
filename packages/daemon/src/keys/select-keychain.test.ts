import assert from "node:assert/strict";
import { test } from "node:test";
import { FileKeychain } from "./file-keychain.ts";
import { MacosKeychain } from "./macos-keychain.ts";
import { selectKeychain } from "./select-keychain.ts";

test("darwin elige el Llavero", () => {
  assert.ok(selectKeychain({ home: "/h", platform: "darwin", env: {} }) instanceof MacosKeychain);
});

test("otras plataformas fallan nombrando la plataforma, sin caer al fichero", () => {
  for (const platform of ["linux", "win32", "freebsd"] as const) {
    assert.throws(
      () => selectKeychain({ home: "/h", platform, env: {} }),
      new RegExp(`plataforma "${platform}"`),
    );
  }
});

test("sin TOGI_KEYCHAIN=file nunca se usa el keychain en fichero", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    for (const env of [{}, { TOGI_KEYCHAIN: "" }]) {
      try {
        assert.ok(!(selectKeychain({ home: "/h", platform, env }) instanceof FileKeychain));
      } catch (error) {
        assert.match((error as Error).message, /plataforma/);
      }
    }
  }
  assert.throws(
    () => selectKeychain({ home: "/h", platform: "darwin", env: { TOGI_KEYCHAIN: "File" } }),
    /no es válido/,
  );
});

test("TOGI_KEYCHAIN=file elige el fichero en cualquier plataforma", () => {
  for (const platform of ["darwin", "linux"] as const) {
    const env = { TOGI_KEYCHAIN: "file" };
    assert.ok(selectKeychain({ home: "/h", platform, env }) instanceof FileKeychain);
  }
});
