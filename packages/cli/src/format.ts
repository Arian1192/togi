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

/** Sangría de la segunda línea de `task show`: el ancho de `#N` más los dos espacios que lo separan del título. */
export const headerIndent = (n: number): string => " ".repeat(`#${n}`.length + 2);

/** Fecha relativa a `now` (inyectable en los tests): `ahora`, `hace 5 min`, `hace 2 h`, `hace 1 d`. */
export function relativeTime(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return say("time_now");
  if (min < 60) return say("time_min", { n: min });
  if (min < 1440) return say("time_hour", { n: Math.floor(min / 60) });
  return say("time_day", { n: Math.floor(min / 1440) });
}

/** Texto de una tarea en una sola línea y sin caracteres de control. */
export const oneLine = (text: string): string => clean(text).replace(/[\n\t]+/g, " ");
