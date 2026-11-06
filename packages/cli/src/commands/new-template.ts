import { MARKER } from "./edit-template.ts";

type Field = "title" | "description" | "acceptanceCriteria" | "risk";

const HEADERS: Record<string, Field> = {
  [`${MARKER} título`]: "title",
  [`${MARKER} descripción`]: "description",
  [`${MARKER} criterio`]: "acceptanceCriteria",
  [`${MARKER} riesgo`]: "risk",
};

/** Riesgo que la plantilla sugiere si no se pasó `--risk`. */
export const SUGGESTED_RISK = "medium";

export interface NewTemplateInput {
  repo: string;
  /** `undefined` con `--repo` y sin `--base`: la rama es la de la API. */
  baseBranch: string | undefined;
  risk: string;
}

/** Lo que escribió la persona. El riesgo viene sin validar: lo valida `CreateTask`. */
export interface NewTaskText {
  title: string;
  description: string;
  acceptanceCriteria: string;
  risk: string;
}

/** Plantilla para el editor, con el repo y la rama que se usarán y el riesgo ya sugerido. */
export function buildNewTemplate({ repo, baseBranch, risk }: NewTemplateInput): string {
  const base = baseBranch ?? "la rama por defecto";
  return `${[
    `${MARKER} Tarea nueva en ${repo} → ${base}. Las líneas que empiezan por ${MARKER} se ignoran.`,
    `${MARKER} Guarda el fichero sin título, descripción ni criterio para cancelar.`,
    "",
    `${MARKER} título`,
    "",
    `${MARKER} descripción`,
    "",
    `${MARKER} criterio`,
    `${MARKER} Sin criterio de aceptación la tarea se crea en draft y no se envía a planificar.`,
    "",
    `${MARKER} riesgo`,
    `${MARKER} low, medium o high.`,
    risk,
  ].join("\n")}\n`;
}

const trimBlank = (block: string[]): string[] => {
  let start = 0;
  let end = block.length;
  while (start < end && block[start]?.trim() === "") start++;
  while (end > start && block[end - 1]?.trim() === "") end--;
  return block.slice(start, end);
};

/**
 * Interpreta el fichero del editor. `null` si no hay título, descripción ni criterio: cancela (el
 * riesgo solo no cuenta, porque la plantilla ya lo trae). El título es una sola línea: si el editor
 * lo parte, se une con espacios.
 */
export function parseNewTemplate(text: string): NewTaskText | null {
  const sections = new Map<Field, string[]>();
  let current: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(MARKER)) {
      const field = HEADERS[line.trimEnd()];
      if (field !== undefined) {
        current = sections.get(field) ?? [];
        sections.set(field, current);
      }
      continue;
    }
    current?.push(line);
  }
  const get = (field: Field) => trimBlank(sections.get(field) ?? []);
  const result: NewTaskText = {
    title: get("title")
      .map((l) => l.trim())
      .join(" "),
    description: get("description").join("\n"),
    acceptanceCriteria: get("acceptanceCriteria").join("\n"),
    risk: get("risk")
      .map((l) => l.trim())
      .join(" "),
  };
  return result.title === "" && result.description === "" && result.acceptanceCriteria === ""
    ? null
    : result;
}
