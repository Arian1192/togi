import assert from "node:assert/strict";
import { test } from "node:test";
import { createNotifier, SCRIPT } from "./notifier.ts";

const hostile = { title: 'a"; do shell script "touch /tmp/x" --', message: "\\ \n \u001b[2J" };

function fake(deps: Parameters<typeof createNotifier>[0] = {}) {
  const calls: string[][] = [];
  const logs: string[] = [];
  const notifier = createNotifier({
    platform: "darwin",
    env: {},
    run: async (args) => {
      calls.push(args);
    },
    log: (line) => logs.push(line),
    ...deps,
  });
  return { notifier, calls, logs };
}

test("en macOS llama a osascript con el script fijo y el texto solo como argumentos", () => {
  const { notifier, calls } = fake();
  notifier.notify({ title: "togi: plan listo", message: "#4 · togi plan show 4" });
  assert.deepEqual(calls, [["-e", SCRIPT, "--", "togi: plan listo", "#4 · togi plan show 4"]]);
});

test("un texto hostil llega literal como argumento y el script no cambia", () => {
  const { notifier, calls } = fake();
  notifier.notify({ title: "normal", message: "normal" });
  notifier.notify(hostile);
  assert.equal(calls[0]?.[1], calls[1]?.[1]);
  assert.equal(calls[1]?.[1], SCRIPT);
  assert.deepEqual(calls[1]?.slice(3), [hostile.title, hostile.message]);
});

test("fuera de macOS no llama a osascript y lo anota una sola vez", () => {
  const { notifier, calls, logs } = fake({ platform: "linux" });
  notifier.notify(hostile);
  notifier.notify(hostile);
  assert.equal(calls.length, 0);
  assert.deepEqual(logs, ["notificaciones no disponibles fuera de macOS"]);
});

test("TOGI_NOTIFY=off no envía nada y no hace ruido, ni siquiera fuera de macOS", () => {
  for (const platform of ["darwin", "linux"] as const) {
    const { notifier, calls, logs } = fake({ platform, env: { TOGI_NOTIFY: "off" } });
    notifier.notify(hostile);
    assert.equal(calls.length, 0);
    assert.equal(logs.length, 0);
  }
});

test("si osascript rechaza solo se anota, limpio de secretos y de caracteres de control", async () => {
  const key = ["sk", "ant", "api03", "C".repeat(40)].join("-");
  const { notifier, logs } = fake({
    run: async () => {
      throw new Error(`falló \u001b[31m${key}`);
    },
  });
  notifier.notify(hostile);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /^no se pudo enviar la notificación: Error: falló/);
  assert.ok(!(logs[0] ?? "").includes(key));
  assert.ok(!(logs[0] ?? "").includes("\u001b"));
});

test("si osascript lanza de forma síncrona tampoco se propaga", () => {
  const { notifier, logs } = fake({
    run: () => {
      throw new Error("no existe");
    },
  });
  assert.doesNotThrow(() => notifier.notify(hostile));
  assert.equal(logs.length, 1);
});
