import { MESSAGES, type MessageParams } from "./messages.ts";
import type { Output } from "./output.ts";

/** Texto del catálogo (solo el `text`). */
export const say = (key: string, params: MessageParams = {}): string =>
  MESSAGES[key]?.(params).text ?? key;

/** Quita los caracteres de control salvo salto de línea y tabulador: el texto de una tarea no puede mover la terminal. */
export const clean = (text: string): string => text.replace(/(?![\n\t])\p{Cc}/gu, "");

/** Sección de texto de `task show`: título, y el contenido con sangría, `(vacío)` o `[borrado]` en gris. */
export function section(
  heading: string,
  text: string | null,
  erased: boolean,
  out: Output,
): string {
  if (text === null) {
    return `${heading}\n  ${out.paint("muted", say(erased ? "text_erased" : "text_empty"))}`;
  }
  return `${heading}\n${clean(text)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}`;
}
