/** Catálogo único de mensajes (español en la rebanada 1) para poder traducirlos después. */
export interface MessageParams {
  /** Número de tarea. */
  n?: number;
  state?: string;
  /** Flag o campo que falló, si la CLI lo conoce. */
  field?: string;
  command?: string;
  suggestion?: string;
}

export interface NextStep {
  label: string;
  /** Comando sugerido, que se pinta con el token `accent`. */
  command?: string;
}

export interface Message {
  text: string;
  next?: NextStep;
  /** Aviso extra en la misma línea del mensaje. */
  warning?: string;
}

const task = (p: MessageParams) => `#${p.n ?? "?"}`;
const edit = (p: MessageParams) => `togi task edit ${p.n ?? "<número>"}`;
const showTask = (p: MessageParams) => `togi task show ${p.n ?? "<número>"}`;

export const MESSAGES: Record<string, (p: MessageParams) => Message> = {
  daemon_unavailable: () => ({
    text: "No hay ningún daemon escuchando en el socket.",
    next: { label: "Arráncalo con", command: "togi daemon start" },
  }),
  unauthorized: () => ({
    text: "El token no es válido.",
    next: { label: "Revisa ~/.togi/credentials" },
  }),
  task_not_found: (p) => ({
    text: `La tarea ${task(p)} no existe.`,
    next: { label: "Mira las que hay con", command: "togi status" },
  }),
  missing_acceptance_criteria: (p) => ({
    text: `La tarea ${task(p)} no tiene criterio de aceptación, así que no puede salir de draft.`,
    next: { label: "Añádelo con", command: edit(p) },
  }),
  missing_risk: (p) => ({
    text: `La tarea ${task(p)} no tiene nivel de riesgo, así que no puede salir de draft.`,
    next: { label: "Añádelo con", command: edit(p) },
  }),
  task_final: (p) => ({
    text: `La tarea ${task(p)} ya está cerrada${p.state === undefined ? "" : ` (${p.state})`}.`,
  }),
  invalid_state: (p) => ({
    text: "Esta acción no es posible en el estado actual.",
    next: { label: "Consulta el estado con", command: showTask(p) },
  }),
  invalid_reason: () => ({
    text: "El rechazo necesita un motivo con texto.",
    next: { label: "Indícalo con", command: "--reason" },
  }),
  empty_edit: () => ({ text: "La edición no cambia nada." }),
  idempotency_key_reused: () => ({
    text: "Esa clave de idempotencia ya se usó con otro contenido.",
  }),
  precondition_failed: (p) => ({
    text: `La tarea ${task(p)} cambió mientras la editabas.`,
    next: { label: "Repite el comando: la CLI relee la versión" },
  }),
  version_conflict: () => ({
    text: "Otra escritura llegó a la vez.",
    next: { label: "Repite el comando" },
  }),
  validation_error: (p) => ({
    text: `Un valor no es válido${p.field === undefined ? "" : ` (${p.field})`}.`,
    next: { label: "Mira el uso con", command: "togi <comando> --help" },
  }),
  integrity_error: () => ({
    text: "El log o un blob no supera la verificación.",
    warning: "Puede indicar una manipulación.",
    next: { label: "Verifícalo con", command: "togi admin verify-log" },
  }),
  unknown_command: (p) => ({
    text: `Comando desconocido: ${p.command ?? ""}`,
    ...(p.suggestion === undefined ? {} : { next: { label: `¿Querías decir ${p.suggestion}?` } }),
  }),
  usage: (p) => ({
    text: p.command ?? "Uso incorrecto.",
    next: { label: "Mira el uso con", command: "togi --help" },
  }),
};

export const unexpected = (status: number): Message => ({
  text: `Error inesperado (HTTP ${status}).`,
});
