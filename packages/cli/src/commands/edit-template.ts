import type { EditInput } from "./task-flow.ts";

/** Prefijo de los comentarios y las cabeceras de sección. El resto de líneas, incluidas las que empiezan por `#`, son texto. */
export const MARKER = "#togi";

type Field = "title" | "description" | "acceptanceCriteria";

const HEADERS: Record<string, Field> = {
  [`${MARKER} título`]: "title",
  [`${MARKER} descripción`]: "description",
  [`${MARKER} criterio`]: "acceptanceCriteria",
};
const ORDER: [Field, string][] = [
  ["title", `${MARKER} título`],
  ["description", `${MARKER} descripción`],
  ["acceptanceCriteria", `${MARKER} criterio`],
];

/** Los datos de la tarea que la plantilla muestra. `null` es vacío, o borrado si su indicador lo dice. */
export interface TemplateTask {
  number: number;
  version: number;
  title: string | null;
  description: string | null;
  acceptanceCriteria: string | null;
  erased: Record<Field, boolean>;
}

const lines = (text: string): string[] => text.split(/\r?\n/);

/** ¿Algún texto actual tiene una línea que el parser tomaría por comentario o cabecera? Entonces no se puede editar con plantilla. */
export function hasMarkerLine(task: TemplateTask): boolean {
  return [task.title, task.description, task.acceptanceCriteria].some(
    (text) => text !== null && lines(text).some((line) => line.startsWith(MARKER)),
  );
}

/** Plantilla para el editor. Un campo borrado lleva un comentario y ningún texto. */
export function buildTemplate(task: TemplateTask): string {
  const out = [
    `${MARKER} Tarea #${task.number} · versión ${task.version}. Las líneas que empiezan por ${MARKER} se ignoran.`,
    `${MARKER} Guarda el fichero vacío para cancelar.`,
  ];
  for (const [field, header] of ORDER) {
    out.push("", header);
    if (task.erased[field]) {
      out.push(
        `${MARKER} [borrado] Escribe debajo para reemplazarlo; si lo dejas vacío no se toca.`,
      );
    } else {
      const text = task[field];
      if (text !== null) out.push(...lines(text));
    }
  }
  return `${out.join("\n")}\n`;
}

/** Quita las líneas en blanco del principio y del final; el interior se conserva tal cual. */
function trimBlankLines(block: string[]): string[] {
  let start = 0;
  let end = block.length;
  while (start < end && block[start]?.trim() === "") start++;
  while (end > start && block[end - 1]?.trim() === "") end--;
  return block.slice(start, end);
}

/**
 * Interpreta el fichero del editor. `null` si no hay nada que enviar (vacío o solo comentarios y
 * cabeceras): cancela. Una sección que falta no se toca. Una sección vacía vacía el campo, salvo si
 * estaba borrado: ahí tampoco se toca. Una cabecera repetida añade su contenido al mismo campo.
 */
export function parseTemplate(text: string, erased: Record<Field, boolean>): EditInput | null {
  const sections = new Map<Field, string[]>();
  let current: string[] | undefined;
  let hasContent = false;
  for (const line of lines(text)) {
    if (line.startsWith(MARKER)) {
      const field = HEADERS[line.trimEnd()];
      if (field !== undefined) {
        current = sections.get(field) ?? [];
        sections.set(field, current);
      }
      continue;
    }
    if (line.trim() !== "") hasContent = true;
    current?.push(line);
  }
  if (!hasContent) return null;
  const input: EditInput = {};
  for (const [field, block] of sections) {
    const value = trimBlankLines(block);
    if (value.length === 0 && erased[field]) continue;
    // El título es una sola línea: si el editor lo parte, se une con espacios.
    input[field] = field === "title" ? value.map((l) => l.trim()).join(" ") : value.join("\n");
  }
  return input;
}
