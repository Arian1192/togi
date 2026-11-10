import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyHeader,
  EMPTY,
  type Header,
  keepLog,
  type LogEntry,
  MAX_LOG,
  MAX_TASK_LOG,
  type MesaState,
} from "./mesa.ts";

// Con varias tareas a la vez, el registro de la mesa guarda lo último de cada una: una muy activa
// no se lleva por delante la historia de las demás.

const entry = (seq: number, number: number): LogEntry => ({
  seq,
  at: "2026-11-10T09:30:00.000Z",
  number,
  name: "tool.use",
  who: "Constructor",
});

test("una tarea muy activa no borra lo de las demás", () => {
  const busy = Array.from({ length: 60 }, (_, i) => entry(i + 2, 5));
  const kept = keepLog([entry(1, 7), ...busy]);
  assert.equal(kept.filter((e) => e.number === 5).length, MAX_TASK_LOG);
  assert.deepEqual(
    kept.filter((e) => e.number === 7).map((e) => e.seq),
    [1],
    "lo de la #7 sigue",
  );
  assert.deepEqual(
    kept.map((e) => e.seq),
    [1, ...busy.slice(-MAX_TASK_LOG).map((e) => e.seq)],
    "en su orden",
  );
});

test("entre todas las tareas, como mucho MAX_LOG eventos: los más recientes", () => {
  const many = Array.from({ length: MAX_LOG + 50 }, (_, i) => entry(i + 1, i));
  const kept = keepLog(many);
  assert.equal(kept.length, MAX_LOG);
  assert.equal(kept[0]?.seq, 51);
  assert.equal(kept.at(-1)?.seq, MAX_LOG + 50);
});

test("la mesa guarda así su registro", () => {
  const h = (seq: number, number: number): Header => ({
    seq,
    at: "2026-11-10T09:30:00.000Z",
    number,
    name: "plan.proposed",
    actor: { kind: "agent", role: "planner" },
  });
  let s: MesaState = applyHeader(EMPTY, h(1, 7));
  for (let seq = 2; seq <= 40; seq++) s = applyHeader(s, h(seq, 5));
  assert.equal(s.log?.filter((e) => e.number === 7).length, 1);
  assert.equal(s.log?.filter((e) => e.number === 5).length, MAX_TASK_LOG);
});
