import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeLine, ToWorker, WorkerInput } from "./worker-protocol.ts";

// La instalación de dependencias (ADR-011 §4) es una orden aparte de la sesión del agente: sin
// credencial, sin entrada y sin ninguna credencial en la especificación.

const install = {
  type: "install",
  sessionId: "ins_1",
  spec: {
    readPaths: [],
    writeDir: "/w/wsp_1/install",
    workTree: "/w/wsp_1/tree",
    pnpmLocks: true,
    allowedDomains: ["registry.npmjs.org"],
    allowedEnv: ["PATH"],
    credentials: [],
    timeoutMs: 1000,
  },
  workspacesRoot: "/w",
  runtimePaths: [],
  argv: ["pnpm", "install"],
};

test("una orden de instalación válida la acepta el trabajador, en una sola línea", () => {
  const line = encodeLine(install as never);
  assert.equal(line.split("\n").length, 2);
  assert.deepEqual(WorkerInput.parse(JSON.parse(line)), install);
  assert.equal(WorkerInput.safeParse({ type: "cancel" }).success, true);
});

test("la orden de instalación no admite credenciales, entrada ni campos de más", () => {
  const bad = [
    { ...install, credential: { name: "K", secret: "s" } },
    { ...install, credential: null },
    { ...install, input: "x" },
    { ...install, extra: 1 },
    { ...install, argv: [] },
    { ...install, spec: { ...install.spec, credentials: [{ name: "K", injectDomains: ["a.b"] }] } },
  ];
  for (const message of bad) assert.equal(WorkerInput.safeParse(message).success, false);
});

test("la orden de la sesión del agente no cambia: no acepta una instalación", () => {
  assert.equal(ToWorker.safeParse(install).success, false);
});
