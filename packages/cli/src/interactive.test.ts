import assert from "node:assert/strict";
import { test } from "node:test";
import { editorForNew } from "./commands/new.ts";
import type { CliError } from "./errors.ts";
import { isInteractive } from "./interactive.ts";

const tty = { isTTY: true };
const pipe = { isTTY: undefined }; // un stream que no es terminal no define isTTY
const notTty = { isTTY: false };

test("es interactivo con una terminal en la entrada y en stderr", () => {
  assert.equal(isInteractive(tty, tty), true);
});

test("no lo es si la entrada o stderr no son una terminal", () => {
  assert.equal(isInteractive(pipe, tty), false);
  assert.equal(isInteractive(tty, pipe), false);
  assert.equal(isInteractive(notTty, tty), false);
  assert.equal(isInteractive(pipe, pipe), false);
});

const code = (run: () => unknown): { code: string; exitCode: number } => {
  try {
    run();
  } catch (error) {
    const e = error as CliError;
    return { code: e.code, exitCode: e.exitCode };
  }
  return assert.fail("debía fallar");
};
const interactive = { interactive: true, json: false };

test("con terminal y editor definido, se usa; VISUAL manda sobre EDITOR y se separa por espacios", () => {
  assert.deepEqual(editorForNew(interactive, { EDITOR: "nano" }, "c"), ["nano"]);
  assert.deepEqual(editorForNew(interactive, { VISUAL: "code -w", EDITOR: "nano" }, "c"), [
    "code",
    "-w",
  ]);
});

test("con terminal pero sin editor, dice que falta el editor, no la terminal", () => {
  for (const env of [{}, { EDITOR: "" }, { VISUAL: "  ", EDITOR: undefined }]) {
    assert.deepEqual(
      code(() => editorForNew(interactive, env, "c")),
      {
        code: "new_needs_editor",
        exitCode: 2,
      },
    );
  }
});

test("sin terminal, o con --json, dice que falta la terminal aunque haya editor", () => {
  const env = { EDITOR: "nano" };
  assert.equal(
    code(() => editorForNew({ interactive: false, json: false }, env, "c")).code,
    "new_needs_terminal",
  );
  assert.equal(
    code(() => editorForNew({ interactive: true, json: true }, env, "c")).code,
    "new_needs_terminal",
  );
});
