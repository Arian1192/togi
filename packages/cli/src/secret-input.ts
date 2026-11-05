import type { Readable, Writable } from "node:stream";
import { CliError, usageError } from "./errors.ts";

export interface SecretIO {
  input: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown };
  output: Writable;
}

/** Tope de lo que se lee: una credencial real cabe de sobra y la API admite 512. */
const MAX = 4096;

/** Teclea sin eco: Enter termina, Ctrl+D termina si hay texto, Ctrl+C cancela, Retroceso borra. */
function readHidden(io: SecretIO, prompt: string): Promise<string> {
  const { input, output } = io;
  return new Promise((resolve, reject) => {
    let text = "";
    const finish = (end: () => void) => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
      end();
    };
    function onData(chunk: Buffer | string): void {
      for (const ch of chunk.toString()) {
        if (ch === "\r" || ch === "\n" || (ch === "\u0004" && text !== "")) {
          finish(() => resolve(text));
          return;
        }
        if (ch === "\u0003" || ch === "\u0004") {
          finish(() => reject(new CliError("secret_cancelled", 1)));
          return;
        }
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1);
        else if (ch >= " ") text += ch;
      }
    }
    output.write(prompt);
    input.setRawMode?.(true);
    input.on("data", onData);
    input.resume();
  });
}

/**
 * Lee el secreto por la entrada estándar: por tubería, o en una terminal sin eco. Con una terminal
 * que no puede ocultar el texto se niega. Nunca de argumentos ni del entorno.
 */
export async function readSecret(io: SecretIO, prompt: string, command: string): Promise<string> {
  let secret: string;
  if (io.input.isTTY === true) {
    if (typeof io.input.setRawMode !== "function") throw usageError("secret_input_refused", {});
    secret = await readHidden(io, prompt);
  } else {
    let text = "";
    for await (const chunk of io.input) {
      text += chunk.toString();
      if (text.length > MAX) throw usageError("secret_too_long", { command });
    }
    secret = text.replace(/\r?\n$/, "");
  }
  if (secret === "") throw usageError("secret_empty", { command });
  return secret;
}
