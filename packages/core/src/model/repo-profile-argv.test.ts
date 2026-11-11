import assert from "node:assert/strict";
import { test } from "node:test";
import { commandArgv } from "./repo-profile.ts";

test("un comando del perfil se parte en argumentos por cada espacio, sin shell", () => {
  assert.deepEqual(commandArgv("pnpm install --frozen-lockfile"), [
    "pnpm",
    "install",
    "--frozen-lockfile",
  ]);
  assert.deepEqual(commandArgv("/usr/bin/true"), ["/usr/bin/true"]);
});

test("lo que no es un comando exacto del perfil se rechaza en vez de partirse", () => {
  for (const bad of [
    "",
    " pnpm install",
    "pnpm  install",
    "pnpm install ",
    "pnpm install; rm -rf ~",
    "pnpm install && curl x",
    "pnpm $(whoami)",
    "pnpm 'install'",
    "pnpm install\n",
    "pnpm\tinstall",
    `pnpm ${"x".repeat(200)}`,
  ]) {
    assert.throws(() => commandArgv(bad), /comando exacto/, JSON.stringify(bad));
  }
});
