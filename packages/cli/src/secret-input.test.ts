import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { CliError } from "./errors.ts";
import { readSecret, type SecretIO } from "./secret-input.ts";

const SECRET = "sk-ant-SENTINEL-0123456789";

function tty(setRaw = true) {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    modes: [] as boolean[],
    ...(setRaw
      ? {
          setRawMode(m: boolean) {
            this.modes.push(m);
          },
        }
      : {}),
  });
  const output = new PassThrough();
  let written = "";
  output.on("data", (c: Buffer) => {
    written += c.toString();
  });
  return { io: { input, output } as SecretIO, input, written: () => written };
}

test("por tubería lee el secreto y quita solo el salto de línea final", async () => {
  const input = new PassThrough();
  input.end(`${SECRET}\n`);
  assert.equal(await readSecret({ input, output: new PassThrough() }, "p: ", "c"), SECRET);
});

test("entrada vacía o demasiado larga: error de uso", async () => {
  for (const text of ["", "\n", "x".repeat(5000)]) {
    const input = new PassThrough();
    input.end(text);
    await assert.rejects(
      readSecret({ input, output: new PassThrough() }, "p", "c"),
      (e: unknown) => {
        assert.ok(e instanceof CliError && e.exitCode === 2);
        return true;
      },
    );
  }
});

test("en una terminal teclea sin eco: la salida solo lleva el aviso y el salto de línea", async () => {
  const { io, input, written } = tty();
  const pending = readSecret(io, "Clave: ", "c");
  input.write(`${SECRET}x\u007f`);
  input.write("\r");
  assert.equal(await pending, SECRET);
  assert.equal(written(), "Clave: \n");
  assert.deepEqual(input.modes, [true, false]);
});

test("Ctrl+C cancela y deja la terminal como estaba", async () => {
  const { io, input, written } = tty();
  const pending = readSecret(io, "Clave: ", "c");
  input.write("abc\u0003");
  await assert.rejects(pending, { code: "secret_cancelled" });
  assert.ok(!written().includes("abc"));
  assert.deepEqual(input.modes, [true, false]);
});

test("una terminal que no puede ocultar el texto se rechaza sin leer nada", async () => {
  const { io, input, written } = tty(false);
  input.write(`${SECRET}\n`);
  await assert.rejects(readSecret(io, "Clave: ", "c"), { code: "secret_input_refused" });
  assert.equal(written(), "");
});
