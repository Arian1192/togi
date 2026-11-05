import assert from "node:assert/strict";
import { test } from "node:test";
import { hashAgentEvent, type StoredAgentEvent, verifyAgentChain } from "./agent-hash.ts";
import { GENESIS_HASH } from "./hash.ts";

function chain(sessionId: string, n: number): StoredAgentEvent[] {
  const out: StoredAgentEvent[] = [];
  let prevHash = GENESIS_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const event = {
      sessionId,
      seq,
      at: "2026-11-05T10:00:00.000Z",
      kind: "message" as const,
      payload: `{"n":${seq}}`,
    };
    const hash = hashAgentEvent(prevHash, event);
    out.push({ ...event, prevHash, hash });
    prevHash = hash;
  }
  return out;
}

test("una cadena íntegra, y una vacía, se verifican", () => {
  assert.deepEqual(verifyAgentChain(chain("ses_a", 4)), { ok: true });
  assert.deepEqual(verifyAgentChain([]), { ok: true });
});

test("el hash depende de la sesión, del orden de las claves no", () => {
  const [a] = chain("ses_a", 1);
  const [b] = chain("ses_b", 1);
  assert.notEqual(a?.hash, b?.hash);
  assert.equal(
    hashAgentEvent(GENESIS_HASH, { payload: "x", kind: "usage", at: "t", seq: 1, sessionId: "s" }),
    hashAgentEvent(GENESIS_HASH, { sessionId: "s", seq: 1, at: "t", kind: "usage", payload: "x" }),
  );
});

test("cambiar cualquier campo rompe la cadena en ese evento", () => {
  for (const change of [
    { payload: "{}" },
    { kind: "denied" as const },
    { at: "otra" },
    { sessionId: "ses_x" },
  ]) {
    const events = chain("ses_a", 4).map((e, i) => (i === 1 ? { ...e, ...change } : e));
    assert.deepEqual(verifyAgentChain(events), { ok: false, brokenAt: 2 }, JSON.stringify(change));
  }
});

test("un evento borrado, repetido o reordenado se detecta", () => {
  const events = chain("ses_a", 4);
  assert.deepEqual(verifyAgentChain([events[0], events[2], events[3]] as StoredAgentEvent[]), {
    ok: false,
    brokenAt: 2,
  });
  assert.deepEqual(verifyAgentChain([events[0], events[0]] as StoredAgentEvent[]), {
    ok: false,
    brokenAt: 2,
  });
  assert.deepEqual(verifyAgentChain([events[1], events[0]] as StoredAgentEvent[]), {
    ok: false,
    brokenAt: 1,
  });
});

test("un prevHash que no es el del evento anterior se detecta", () => {
  const events = chain("ses_a", 3).map((e, i) => (i === 2 ? { ...e, prevHash: GENESIS_HASH } : e));
  assert.deepEqual(verifyAgentChain(events), { ok: false, brokenAt: 3 });
});
