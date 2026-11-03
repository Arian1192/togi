import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "./decider.ts";
import type { TaskView } from "./task-view.ts";

const view: TaskView = {
  exists: true,
  state: "draft",
  title: "t",
  description: null,
  acceptanceCriteria: null,
  risk: "low",
};
const meta = { actor: { kind: "human", userId: "usr_1" }, at: "2026-11-03T10:00:00Z" } as const;

test("reject con texto null devuelve invalid_reason", () => {
  const result = decide(
    view,
    { ...meta, type: "reject", reason: { category: "scope", text: null } },
    { maxLines: 300, maxFailedCycles: 3 },
  );
  assert.ok(!Array.isArray(result));
  assert.equal(result.code, "invalid_reason");
});
