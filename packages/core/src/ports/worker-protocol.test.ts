import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeLine, FromWorker, ToWorker } from "./worker-protocol.ts";

const session = {
  type: "session",
  sessionId: "ses_1",
  spec: {
    readPaths: ["/w/repo"],
    writeDir: "/w/scratch",
    allowedDomains: [],
    allowedEnv: ["PATH"],
    credentials: [],
    timeoutMs: 1000,
  },
  workspacesRoot: "/w",
  runtimePaths: [],
  argv: ["/bin/true"],
  credential: null,
};

test("una sesión válida se acepta y se codifica en una sola línea", () => {
  assert.deepEqual(ToWorker.parse(JSON.parse(encodeLine(session as never))), session);
  assert.equal(encodeLine({ type: "heartbeat" }).split("\n").length, 2);
});

test("un campo de más, un tipo desconocido o un argv vacío se rechazan", () => {
  assert.equal(ToWorker.safeParse({ ...session, extra: 1 }).success, false);
  assert.equal(ToWorker.safeParse({ type: "otra" }).success, false);
  assert.equal(ToWorker.safeParse({ ...session, argv: [] }).success, false);
  assert.equal(
    ToWorker.safeParse({ ...session, credential: { name: "K", secret: "" } }).success,
    false,
  );
});

test("el trabajador solo habla con eventos de trayectoria conocidos", () => {
  const ok = { type: "event", sessionId: "s", kind: "tool_call", payload: { a: 1 } };
  assert.equal(FromWorker.safeParse(ok).success, true);
  assert.equal(FromWorker.safeParse({ ...ok, kind: "otro" }).success, false);
  assert.equal(FromWorker.safeParse({ type: "error", code: "texto libre" }).success, false);
});
