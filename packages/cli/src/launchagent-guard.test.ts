import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { paths } from "@togi/daemon/config";
import { managesHome, plistPath, renderPlist } from "./launchd.ts";
import { runCli } from "./testing/run-cli.ts";

function setup(plistHome: string | undefined) {
  const root = mkdtempSync(join(tmpdir(), "togi-guard-"));
  const home = join(root, "togi home");
  const userHome = join(root, "user");
  const agents = join(userHome, "Library", "LaunchAgents");
  mkdirSync(agents, { recursive: true });
  if (plistHome !== undefined) {
    const text = renderPlist({
      node: "/n",
      release: "/r",
      home: plistHome === "mine" ? home : plistHome,
      log: "/l",
    });
    writeFileSync(plistPath(agents), text);
  }
  return { root, home, userHome, agents };
}

test("managesHome: solo si el plist existe y es de esta carpeta TOGI_HOME", () => {
  const mine = setup("mine");
  const other = setup("/otra/carpeta");
  const none = setup(undefined);
  try {
    assert.equal(managesHome(mine.home, mine.agents), true);
    assert.equal(managesHome(other.home, other.agents), false);
    assert.equal(managesHome(none.home, none.agents), false);
  } finally {
    for (const s of [mine, other, none]) rmSync(s.root, { recursive: true, force: true });
  }
});

test("el plist escapa el XML de las rutas", () => {
  const text = renderPlist({ node: "/n", release: "/r&<x>", home: '/h"', log: "/l" });
  assert.ok(text.includes("/r&amp;&lt;x&gt;"));
  assert.ok(text.includes("/h&quot;"));
});

test("togi daemon start con el LaunchAgent activo lo dice y no arranca otro daemon", async () => {
  const s = setup("mine");
  try {
    const r = await runCli(["daemon", "start", "--no-color"], s.home, { HOME: s.userHome });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /lo gestiona launchd/);
    assert.match(r.stderr, /launchctl bootout/);
    assert.ok(!existsSync(paths(s.home).socket));
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("togi daemon stop con el LaunchAgent activo lo dice y no manda ninguna señal", async () => {
  const s = setup("mine");
  try {
    const r = await runCli(["daemon", "stop", "--no-color"], s.home, { HOME: s.userHome });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /lo gestiona launchd/);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("con el plist de otra carpeta TOGI_HOME, start y stop siguen como siempre", async () => {
  const s = setup("/otra/carpeta");
  try {
    const r = await runCli(["daemon", "stop", "--no-color"], s.home, { HOME: s.userHome });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /No hay ningún daemon en marcha/);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});
