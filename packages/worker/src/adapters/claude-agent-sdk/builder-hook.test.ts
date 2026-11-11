import assert from "node:assert/strict";
import { test } from "node:test";
import { type BuilderPolicy, builderHook } from "./builder-policy.ts";
import type { AgentLine } from "./planner-policy.ts";

const policy: BuilderPolicy = {
  root: "/repo",
  checks: { typecheck: "pnpm typecheck", lint: null, test: "pnpm test" },
  planFiles: ["src/a.ts"],
  existingTests: [],
  protectedPaths: [],
};

const setup = () => {
  const lines: AgentLine[] = [];
  return { lines, hook: builderHook(policy, (line) => lines.push(line)) };
};

test("las herramientas fuera de la lista se deniegan y quedan registradas como denied", async () => {
  const { lines, hook } = setup();
  for (const tool of ["WebFetch", "NotebookEdit", "Task"]) {
    const out = await hook({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: {} });
    assert.equal(out.hookSpecificOutput?.permissionDecision, "deny", tool);
    assert.equal(out.hookSpecificOutput?.hookEventName, "PreToolUse");
  }
  assert.deepEqual(
    lines.map((line) => [line.kind, (line.payload as { tool: string }).tool]),
    [
      ["denied", "WebFetch"],
      ["denied", "NotebookEdit"],
      ["denied", "Task"],
    ],
  );
});

test("un rechazo de ruta o de Bash también queda registrado como denied", async () => {
  const { lines, hook } = setup();
  const write = {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: "/repo/b.ts" },
  };
  assert.equal((await hook(write)).hookSpecificOutput?.permissionDecision, "deny");
  const bash = {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "git status" },
  };
  assert.equal((await hook(bash)).hookSpecificOutput?.permissionDecision, "deny");
  assert.deepEqual(
    lines.map((line) => line.kind),
    ["denied", "denied"],
  );
});

test("lo permitido devuelve {} y no registra nada", async () => {
  const { lines, hook } = setup();
  const edit = {
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: "/repo/src/a.ts" },
  };
  assert.deepEqual(await hook(edit), {});
  assert.deepEqual(
    await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }),
    {},
  );
  assert.deepEqual(lines, []);
});
