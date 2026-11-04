/** Catálogo único de mensajes (español en la rebanada 1) para poder traducirlos después. */
export interface MessageParams {
  /** Número de tarea. */
  n?: number;
  state?: string;
  /** Flag o campo que falló, si la CLI lo conoce. */
  field?: string;
  command?: string;
  suggestion?: string;
  pid?: number;
  /** Número de evento del log. */
  event?: number;
  socket?: string;
  /** Cola del log del daemon, ya sin caracteres de control. */
  detail?: string;
  title?: string;
  risk?: string;
  /** Versión de un plan. */
  version?: number;
  production?: number;
  tests?: number;
  limit?: string;
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

/** Texto de una entrada del catálogo con sufijo (`risk_low`); si no existe, el propio valor. */
const t = (prefix: string, value = ""): string =>
  MESSAGES[`${prefix}_${value}`]?.({}).text ?? value;

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
  integrity_error: (p) =>
    p.event === undefined
      ? {
          text: "El log o un blob no supera la verificación.",
          warning: "Puede indicar una manipulación.",
          next: { label: "Verifícalo con", command: "togi admin verify-log" },
        }
      : {
          text: `El evento #${p.event} del log no supera la verificación.`,
          warning: "Puede indicar una manipulación. No sigas trabajando hasta revisarlo.",
        },
  log_verified: () => ({ text: "Log íntegro" }),
  daemon_started: (p) => ({ text: `Daemon arrancado · pid ${p.pid} · ${p.socket}` }),
  daemon_already_running: (p) => ({ text: `El daemon ya está en marcha · pid ${p.pid}` }),
  daemon_stopped: (p) => ({ text: `Daemon parado · pid ${p.pid}` }),
  daemon_not_running: () => ({ text: "No hay ningún daemon en marcha." }),
  daemon_start_failed: (p) => ({
    text: `El daemon murió al arrancar.${p.detail ? `\n${p.detail}` : ""}`,
    next: { label: "Mira el log en ~/.togi/run/daemon.log" },
  }),
  daemon_start_timeout: () => ({
    text: "El daemon no respondió en 10 s y se ha parado.",
    next: { label: "Mira el log en ~/.togi/run/daemon.log" },
  }),
  daemon_pid_mismatch: (p) => ({
    text: `El daemon que responde (pid ${p.pid}) no es el del fichero de pid, así que no se le envía ninguna señal.`,
    next: { label: "Revisa ~/.togi/run/togi.pid" },
  }),
  daemon_stop_timeout: (p) => ({
    text: `El daemon (pid ${p.pid}) no terminó en 10 s.`,
  }),
  unknown_command: (p) => ({
    text: `Comando desconocido: ${p.command ?? ""}`,
    ...(p.suggestion === undefined ? {} : { next: { label: `¿Querías decir ${p.suggestion}?` } }),
  }),
  missing_option: (p) => ({
    text: `Falta ${p.field ?? "un valor"}.`,
    next: { label: "Mira el uso con", command: p.command ?? "togi --help" },
  }),
  invalid_option: (p) => ({
    text: `El valor de ${p.field ?? "un flag"} no es válido${p.detail === undefined ? "" : `: ${p.detail}`}.`,
    next: { label: "Mira el uso con", command: p.command ?? "togi --help" },
  }),
  task_created: (p) => ({
    text: `Creada ${task(p)} «${p.title ?? ""}» (riesgo ${t("risk", p.risk)}, ${p.state ?? "draft"})`,
  }),
  task_submitted: (p) => ({ text: `Enviada ${task(p)} a ${p.state ?? "planning"}` }),
  task_rejected: (p) => ({ text: `Rechazada ${task(p)}` }),
  task_edited: (p) => ({ text: `Editada ${task(p)}` }),
  edit_no_changes: (p) => ({ text: `La tarea ${task(p)} ya tiene esos valores: no hay cambios.` }),
  edit_needs_flags: (p) => ({
    text: `Indica qué editar: --title, --description o --criteria (${task(p)}).`,
    next: { label: "Mira el uso con", command: p.command ?? "togi task edit --help" },
  }),
  edit_cancelled: () => ({ text: "Cancelado. No se ha cambiado nada." }),
  editor_failed: (p) => ({ text: `El editor falló (${p.detail}); no se ha cambiado nada.` }),
  edit_editor_unsafe: (p) => ({
    text: `La tarea ${task(p)} tiene una línea que empieza por #togi y el editor no puede abrirse sin perderla.`,
    next: { label: "Edítala con flags", command: `togi task edit ${p.n ?? "<número>"} --help` },
  }),
  reject_confirm: (p) => ({
    text: `¿Rechazar ${task(p)} «${p.title ?? ""}»? Es definitivo: la tarea queda cerrada. [s/N]`,
  }),
  reject_cancelled: () => ({ text: "Cancelado. No se ha cambiado nada." }),
  confirmation_required: (p) => ({
    text: `Rechazar ${task(p)} necesita confirmación y esto no es una terminal.`,
    next: { label: "Repite con", command: "--yes" },
  }),
  task_missing_criteria: (p) => ({
    text: "Falta el criterio de aceptación",
    next: { label: "Añádelo con", command: edit(p) },
  }),
  risk_low: () => ({ text: "bajo" }),
  risk_medium: () => ({ text: "medio" }),
  risk_high: () => ({ text: "alto" }),
  section_description: () => ({ text: "Descripción" }),
  section_criteria: () => ({ text: "Criterio de aceptación" }),
  text_empty: () => ({ text: "(vacío)" }),
  text_erased: () => ({ text: "[borrado]" }),
  group_pending: () => ({ text: "Pendiente de ti" }),
  group_active: () => ({ text: "En curso" }),
  group_closed: () => ({ text: "Cerradas" }),
  missing_criteria_short: () => ({ text: "falta criterio" }),
  time_now: () => ({ text: "ahora" }),
  time_min: (p) => ({ text: `hace ${p.n} min` }),
  time_hour: (p) => ({ text: `hace ${p.n} h` }),
  time_day: (p) => ({ text: `hace ${p.n} d` }),
  status_none: () => ({ text: "No hay tareas." }),
  status_none_in_state: (p) => ({ text: `No hay tareas en estado ${p.state}.` }),
  status_none_open: () => ({ text: "No hay tareas abiertas" }),
  status_truncated: (p) => ({
    text: `Solo se muestran las primeras ${p.n} tareas; puede haber más`,
  }),
  status_tasks: (p) => ({ text: `${p.n} ${p.n === 1 ? "tarea" : "tareas"}` }),
  status_hidden: (p) => ({
    text: `${p.detail} ${p.n === 1 ? "oculta" : "ocultas"} (togi status --all)`,
  }),
  status_rejected: (p) => ({ text: `${p.n} ${p.n === 1 ? "rechazada" : "rechazadas"}` }),
  status_merged: (p) => ({ text: `${p.n} ${p.n === 1 ? "fusionada" : "fusionadas"}` }),
  section_plan_files: () => ({ text: "Ficheros" }),
  section_plan_tests: () => ({ text: "Tests nuevos" }),
  section_plan_approach: () => ({ text: "Enfoque" }),
  plan_change_add: () => ({ text: "añadir" }),
  plan_change_modify: () => ({ text: "modificar" }),
  plan_change_delete: () => ({ text: "borrar" }),
  plan_lines: (p) => ({
    text: `~${p.production} líneas de producción · ~${p.tests} de tests (estimadas)`,
  }),
  plan_exceeds: (p) => ({
    text: `Supera los límites (${p.limit}): no se puede aprobar; pide cambios o rechaza.`,
  }),
  plan_older: () => ({ text: "Enfoque no disponible en versiones anteriores." }),
  plan_not_found: (p) => ({
    text: `La tarea ${task(p)} no tiene plan.`,
    next: { label: "Mira el estado con", command: showTask(p) },
  }),
  plan_version_not_found: (p) => ({
    text: `La tarea ${task(p)} no tiene la versión ${p.version ?? "?"} del plan.`,
    next: { label: "Mira la vigente con", command: `togi plan show ${p.n ?? "<número>"}` },
  }),
  usage: (p) => ({
    text: p.command ?? "Uso incorrecto.",
    next: { label: "Mira el uso con", command: "togi --help" },
  }),
};

export const unexpected = (status: number): Message => ({
  text: `Error inesperado (HTTP ${status}).`,
});
