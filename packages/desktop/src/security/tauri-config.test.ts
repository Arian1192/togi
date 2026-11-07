import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..", "..");
const TAURI = join(ROOT, "src-tauri");
const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");
const config = JSON.parse(read(TAURI, "tauri.conf.json")) as {
  build: { frontendDist: string };
  app: { windows: Record<string, unknown>[]; security: { csp: string } };
};

const directives = (csp: string) =>
  new Map(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .map(([name, ...values]) => [name as string, values] as const),
  );

test("la CSP es estricta: solo el propio bundle, sin unsafe-inline ni unsafe-eval ni URLs remotas", () => {
  const { csp } = config.app.security;
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(csp, /https?:|wss?:|\*/);
  const d = directives(csp);
  assert.deepEqual(d.get("default-src"), ["'self'"]);
  assert.deepEqual(d.get("script-src"), ["'self'"]);
  assert.deepEqual(d.get("object-src"), ["'none'"]);
});

test("el webview carga solo el bundle propio: sin URL remota ni servidor de desarrollo", () => {
  assert.deepEqual(config.build, { frontendDist: "../dist" });
  for (const w of config.app.windows) assert.equal(w.url, undefined);
});

test("las capacidades solo permiten los comandos concretos del daemon y escuchar eventos de Tauri", () => {
  const files = readdirSync(join(TAURI, "capabilities"));
  assert.deepEqual(files, ["default.json"]);
  const capability = JSON.parse(read(TAURI, "capabilities", "default.json")) as {
    permissions: unknown[];
  };
  assert.deepEqual(capability.permissions, [
    "allow-get-daemon-status",
    "allow-list-tasks",
    "allow-watch-events",
    "allow-read-plan",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
  ]);
});

test("los comandos están declarados en build.rs y son los únicos registrados en el invoke handler", () => {
  assert.match(
    read(TAURI, "build.rs"),
    /\.commands\(&\["get_daemon_status", "list_tasks", "watch_events", "read_plan"\]\)/,
  );
  const handler = /generate_handler!\[([^\]]*)\]/.exec(read(TAURI, "src", "lib.rs"))?.[1];
  assert.deepEqual(
    handler
      ?.split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    ["daemon::get_daemon_status", "tasks::list_tasks", "events::watch_events", "plan::read_plan"],
  );
});
