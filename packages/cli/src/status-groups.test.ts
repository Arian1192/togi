import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTENTION_GROUPS, attentionGroup, TASK_STATES } from "@togi/core";
import { createOutput } from "./output.ts";
import { renderStatus, type StatusTask } from "./status-view.ts";

// `togi status` y la app agrupan con la misma función de @togi/core: aquí se comprueba que la CLI la usa.
const NOW = new Date("2026-11-03T12:00:00Z");
const plain = createOutput({ env: { LANG: "es_ES.UTF-8" }, isTTY: false, noColorFlag: true });
const TITLE = { pending: "Pendiente de ti", active: "En curso", closed: "Cerradas" } as const;

const tasks: StatusTask[] = TASK_STATES.map((state, i) => ({
  number: i + 1,
  title: `Tarea ${i + 1}`,
  titleErased: false,
  state,
  risk: "low",
  hasCriteria: true,
  updatedAt: NOW.toISOString(),
}));

/** Las tareas que salen bajo cada título de grupo. */
function groupsOf(out: string): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  let current = "";
  for (const line of out.split("\n")) {
    if (Object.values(TITLE).includes(line as never)) current = line;
    else if (current !== "") {
      const n = /^ {2}#(\d+) /.exec(line)?.[1];
      if (n !== undefined) found[current] = [...(found[current] ?? []), Number(n)];
    }
  }
  return found;
}

test("togi status pone cada tarea bajo el grupo que dice attentionGroup, también draft", () => {
  const found = groupsOf(renderStatus(tasks, { all: true }, plain, NOW));
  for (const group of ATTENTION_GROUPS) {
    const expected = tasks.filter((t) => attentionGroup(t.state) === group).map((t) => t.number);
    assert.deepEqual(found[TITLE[group]], expected, group);
  }
  const draft = tasks.find((t) => t.state === "draft");
  assert.ok(found[TITLE.pending]?.includes(draft?.number ?? 0), "draft en «Pendiente de ti»");
});

test("sin --all, las cerradas no salen y se cuentan como ocultas", () => {
  const out = renderStatus(tasks, { all: false }, plain, NOW);
  assert.equal(groupsOf(out)[TITLE.closed], undefined);
  assert.match(out, /7 tareas · 1 rechazada y 1 fusionada ocultas/);
});
