import { closeSync, openSync, readSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

/** Cuánto del final del fichero se lee para sacar las últimas líneas. */
const TAIL_BYTES = 64 * 1024;
/** Una línea más larga se corta: el log lo escribe un proceso que recoge texto de agentes. */
const MAX_LINE_CHARS = 2000;
export const MAX_LINES = 1000;
export const DEFAULT_LINES = 50;

// Los caracteres de control están en estas expresiones para quitarlos, a propósito.
// biome-ignore lint/suspicious/noControlCharactersInRegex: se quitan a propósito
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: se quitan a propósito
const CSI = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]?/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: se quitan a propósito
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * Texto del log listo para una terminal: sin secuencias de escape (color, título, cursor), sin
 * caracteres de control ni C1, y sin retornos de carro. Conserva el salto de línea y el tabulador.
 */
export const cleanLogText = (text: string): string =>
  text.replace(OSC, "").replace(CSI, "").replace(CONTROL, "");

const cleanLine = (line: string): string => {
  const clean = cleanLogText(line);
  return clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS)}…` : clean;
};

/** El tamaño del fichero, o `undefined` si no existe. */
export function logSize(file: string): number | undefined {
  try {
    return statSync(file).size;
  } catch {
    return undefined;
  }
}

function readRange(file: string, from: number, to: number): Buffer {
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(to - from);
    const read = readSync(fd, buffer, 0, buffer.length, from);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/**
 * Las últimas `count` líneas del log, ya limpias, y hasta dónde se leyó (para seguirlo desde ahí sin
 * repetir ni perder nada). Solo lee el final del fichero.
 */
export function tailLog(file: string, count: number): { lines: string[]; size: number } {
  const size = logSize(file) ?? 0;
  const from = Math.max(0, size - TAIL_BYTES);
  const lines = readRange(file, from, size).toString("utf8").split("\n");
  // Si se empezó a mitad del fichero, la primera línea llega cortada: se descarta.
  if (from > 0) lines.shift();
  if (lines.at(-1) === "") lines.pop();
  return { lines: lines.slice(-count).map(cleanLine), size };
}

/**
 * Sigue el log: entrega las líneas nuevas según se escriben, hasta que se aborta. Si el fichero se
 * vacía o se sustituye (más pequeño que lo leído), vuelve a empezar desde el principio.
 */
export async function followLog(
  file: string,
  from: number,
  emit: (line: string) => void,
  signal: AbortSignal,
  pollMs = 500,
): Promise<void> {
  const decoder = new StringDecoder("utf8");
  let position = from;
  let partial = "";
  while (!signal.aborted) {
    const size = logSize(file);
    if (size !== undefined && size < position) {
      position = 0;
      partial = "";
    }
    if (size !== undefined && size > position) {
      const text = partial + decoder.write(readRange(file, position, size));
      position = size;
      const lines = text.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) emit(cleanLine(line));
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, pollMs);
      signal.addEventListener("abort", done);
    });
  }
}
