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
  /** Sesión de agente cuya trayectoria no supera la verificación. */
  session?: string;
  socket?: string;
  /** Cola del log del daemon, ya sin caracteres de control. */
  detail?: string;
  title?: string;
  risk?: string;
  /** Versión de un plan. */
  version?: number;
  /** Código de `FailureReason` de la última sesión; un código desconocido se muestra tal cual. */
  reason?: string;
  production?: number;
  tests?: number;
  limit?: string;
  /** owner/repo y ruta de un repo registrado. */
  repo?: string;
  path?: string;
  /** Rama base. */
  base?: string;
  /** Etiquetas instaladas del daemon y de la CLI. */
  daemonRelease?: string;
  cliRelease?: string;
  seconds?: number;
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

/** Sin caracteres de control: una ruta o un nombre no pueden mover la terminal. */
const plain = (text: string | undefined, fallback: string): string =>
  text === undefined ? fallback : text.replace(/\p{Cc}/gu, "");
const repoName = (p: MessageParams) => plain(p.repo, "<owner/repo>");
const repoPath = (p: MessageParams) => plain(p.path, "<ruta>");
const listRepos = { label: "Mira los que hay con", command: "togi repo list" };

const task = (p: MessageParams) => `#${p.n ?? "?"}`;
/** Línea con el porqué de la última sesión fallida, si se conoce. */
const lastSession = (p: MessageParams) =>
  p.reason === undefined
    ? ""
    : `\nÚltima sesión: ${plain(MESSAGES[`failure_reason_${p.reason}`]?.({}).text ?? p.reason, "?")}.`;
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
  invalid_state: (p) => {
    const n = p.n ?? "<número>";
    // Qué se puede hacer según dónde esté la tarea. Sin estado, el aviso de siempre.
    const advice: Record<string, string> = {
      draft: `aún no tiene plan. Envíala con togi task submit ${n} (o edítala con togi task edit ${n}).`,
      planning: `la planifica el agente. Sigue con togi watch o togi plan show ${n}; si la sesión falló, reintenta con togi plan retry ${n}.`,
      plan_review: `espera tu decisión sobre el plan. Míralo con togi plan show ${n} y decide con togi plan approve ${n}, togi plan request-changes ${n} (para cambiarlo) o togi plan reject ${n}.`,
    };
    const state = p.state;
    const text =
      state === undefined
        ? "Esta acción no es posible en el estado actual."
        : `Esta acción no es posible en el estado actual: ${task(p)} está en ${state}, ${advice[state] ?? "y ya no admite esa acción."}`;
    return { text, next: { label: "Consulta el estado con", command: showTask(p) } };
  },
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
    p.event !== undefined && p.session !== undefined
      ? {
          text: `El evento #${p.event} de la trayectoria de la sesión ${plain(p.session, "?")} no supera la verificación.`,
          warning: "Puede indicar una manipulación. No sigas trabajando hasta revisarlo.",
        }
      : p.event === undefined
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
  daemon_log_missing: () => ({
    text: "Todavía no hay log del daemon: no ha arrancado nunca con este TOGI_HOME.",
    next: { label: "Arráncalo con", command: "togi daemon start" },
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
  plan_approved: (p) => ({ text: `Aprobado el plan de ${task(p)} · ${p.state ?? "building"}` }),
  plan_changes_requested: (p) => ({
    text: `Pedidos cambios sobre el plan de ${task(p)} · vuelve a planning`,
  }),
  repo_not_inferred: (p) => {
    const why: Record<string, string> = {
      not_a_repo: "este directorio no está dentro de un repo git",
      no_origin: "el repo git no tiene un remote origin",
      not_github: "el remote origin no es de GitHub",
      not_registered: `el repo ${repoName(p)} de este directorio no está registrado`,
    };
    return {
      text: `No se pudo deducir el repo: ${why[p.reason ?? ""] ?? "motivo desconocido"}.`,
      next:
        p.reason === "not_registered"
          ? { label: "Regístralo con", command: `togi repo add ${repoName(p)} --path <ruta>` }
          : { label: "Indícalo con", command: "--repo <owner/repo>" },
    };
  },
  base_not_inferred: (p) => ({
    text: `Se deduce el repo ${repoName(p)} pero no su rama base: origin/HEAD no existe o su nombre no es válido. Puedes fijarlo con git remote set-head origin --auto.`,
    next: { label: "Indícala con", command: "--base <rama>" },
  }),
  repo_inferred: (p) => ({
    text:
      p.base === undefined
        ? `Repo deducido del directorio: ${repoName(p)}`
        : `Repo y rama base deducidos del directorio: ${repoName(p)} → ${plain(p.base, "?")}`,
  }),
  not_configured: () => ({
    text: "El daemon no tiene disponible lo que hace falta, por ejemplo un planificador activo.",
    next: { label: "Mira su estado con", command: "togi daemon status" },
  }),
  plan_retry_requested: (p) => ({
    text: `Pedida otra sesión de planificación para ${task(p)}`,
    next: { label: "Sigue su estado con", command: showTask(p) },
  }),
  session_already_active: (p) => ({
    text: `La tarea ${task(p)} ya tiene una sesión de planificación en curso.`,
    next: { label: "Consulta el estado con", command: showTask(p) },
  }),
  plan_rejected: (p) => ({ text: `Rechazado el plan de ${task(p)}: la tarea queda cerrada` }),
  plan_reject_confirm: (p) => ({
    text: `¿Rechazar el plan de ${task(p)} «${p.title ?? ""}»? Es definitivo: la tarea queda cerrada. [s/N]`,
  }),
  plan_changed: (p) => ({
    text: `El plan de ${task(p)} cambió antes de que se registrara tu decisión; no se ha guardado nada.`,
    next: {
      label: "Léelo de nuevo antes de decidir",
      command: `togi plan show ${p.n ?? "<número>"}`,
    },
  }),
  plan_exceeds_limits: (p) => ({
    text: `El plan de ${task(p)} supera los límites de tamaño y no se puede aprobar.`,
    next: {
      label: "Pide cambios con",
      command: `togi plan request-changes ${p.n ?? "<número>"} --help`,
    },
  }),
  task_edited: (p) => ({ text: `Editada ${task(p)}` }),
  edit_no_changes: (p) => ({ text: `La tarea ${task(p)} ya tiene esos valores: no hay cambios.` }),
  edit_needs_flags: (p) => ({
    text: `Indica qué editar: --title, --description o --criteria (${task(p)}).`,
    next: { label: "Mira el uso con", command: p.command ?? "togi task edit --help" },
  }),
  new_cancelled: () => ({ text: "Cancelado. No se ha creado ninguna tarea." }),
  new_needs_terminal: () => ({
    text: "togi new abre el editor y necesita una terminal (y no admite --json).",
    next: { label: "Fuera de una terminal usa", command: "togi task new --help" },
  }),
  new_needs_editor: () => ({
    text: "togi new necesita un editor y no hay $VISUAL ni $EDITOR definidos.",
    next: { label: "Define uno, por ejemplo", command: "export EDITOR=nano" },
  }),
  new_draft_kept: (p) => ({
    text: `Queda en draft (--draft): envíala con togi task submit ${p.n ?? "<número>"}`,
  }),
  follow_waiting: (p) => ({ text: `Esperando a que el planificador empiece con ${task(p)}…` }),
  follow_session_started: () => ({ text: "Sesión de planificación en curso…" }),
  follow_plan_ready: (p) => ({
    text: `Plan listo: apruébalo con togi plan approve ${p.n ?? "<número>"} o pide cambios con togi plan request-changes ${p.n ?? "<número>"}.`,
  }),
  follow_stopped: (p) => ({
    text: `Dejo de seguir ${task(p)}: la tarea continúa. Retómalo con togi plan show ${p.n ?? "<número>"} o togi watch.`,
  }),
  follow_session_failed: (p) => {
    const why =
      MESSAGES[`failure_reason_${p.reason}`]?.({}).text ?? plain(p.reason, "motivo desconocido");
    return {
      text: `La planificación de ${task(p)} falló: ${why}.`,
      next: { label: "Reintenta con", command: `togi plan retry ${p.n ?? "<número>"}` },
    };
  },
  follow_no_session: (p) => {
    const planner =
      p.state === undefined
        ? ""
        : ` El planificador está ${p.state === "disabled" ? "desactivado" : "no disponible"}: ${plain(p.detail, "sin motivo")}.`;
    return {
      text: `Han pasado ${p.seconds ?? "?"} s sin que empiece ninguna sesión de planificación de ${task(p)}. Puede estar en cola tras otra tarea, o el orquestador pudo fallar sin abrir sesión.${planner}`,
      next: { label: "Mira el log en ~/.togi/run/daemon.log" },
    };
  },
  follow_hint: (p) => ({
    text: `Sigue el progreso con: togi watch · togi plan show ${p.n ?? "<número>"}`,
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
  last_session_failed: (p) => ({ text: lastSession(p).trim() }),
  failure_reason_repo_not_registered: () => ({
    text: "el repo de la tarea no está registrado (usa togi repo add)",
  }),
  failure_reason_timeout: () => ({ text: "se agotó el tiempo de la sesión" }),
  failure_reason_worker_died: () => ({ text: "el trabajador murió antes de terminar" }),
  failure_reason_invalid_plan: () => ({ text: "el plan que propuso el agente no era válido" }),
  failure_reason_planner_error: () => ({ text: "el planificador falló con un error inesperado" }),
  failure_reason_planner_failed: () => ({ text: "el planificador no logró proponer un plan" }),
  failure_reason_trajectory_write_failed: () => ({
    text: "no se pudo registrar la trayectoria del agente",
  }),
  failure_reason_agent_failed: () => ({ text: "el agente terminó con error" }),
  failure_reason_daemon_restarted: () => ({ text: "el daemon se reinició durante la sesión" }),
  failure_reason_max_turns_exceeded: () => ({ text: "el agente agotó su tope de turnos" }),
  failure_reason_budget_exceeded: () => ({ text: "el agente agotó su tope de coste" }),
  failure_reason_sandbox_unavailable: () => ({
    text: "el sandbox no pudo arrancar, así que no se lanzó el agente (togi nunca ejecuta uno sin sandbox)",
  }),
  planner_active: () => ({ text: "planificador activo" }),
  planner_disabled: (p) => ({
    text: `planificador desactivado (${plain(p.reason, "sin motivo")})`,
  }),
  planner_unavailable: (p) => ({
    text: `planificador no disponible (${plain(p.reason, "sin motivo")})`,
  }),
  notify_active: () => ({ text: "notificaciones activas" }),
  notify_disabled: (p) => ({
    text: `notificaciones desactivadas (${plain(p.reason, "sin motivo")})`,
  }),
  notify_unavailable: (p) => ({
    text: `notificaciones no disponibles (${plain(p.reason, "sin motivo")})`,
  }),
  release_mismatch: (p) => ({
    text: `El daemon es ${plain(p.daemonRelease, "?")} y la CLI ${plain(p.cliRelease, "?")}.`,
    next: { label: "Actualiza el daemon con", command: `togi update ${plain(p.cliRelease, "?")}` },
  }),
  failure_reason_credential_missing: () => ({
    text: "falta la credencial del agente: configúrala con `togi auth set-api-key` o `togi auth use-subscription` y reintenta",
  }),
  plan_not_found: (p) => ({
    text: `La tarea ${task(p)} no tiene plan.${lastSession(p)}`,
    next: { label: "Mira el estado con", command: showTask(p) },
  }),
  plan_version_not_found: (p) => ({
    text: `La tarea ${task(p)} no tiene la versión ${p.version ?? "?"} del plan.`,
    next: { label: "Mira la vigente con", command: `togi plan show ${p.n ?? "<número>"}` },
  }),
  repo_added: (p) => ({ text: `Registrado ${repoName(p)} → ${repoPath(p)}` }),
  repo_removed: (p) => ({ text: `Dado de baja ${repoName(p)}` }),
  repos_empty: () => ({
    text: "No hay repos registrados.",
    next: { label: "Registra uno con", command: "togi repo add <owner/repo> --path <ruta>" },
  }),
  path_not_found: (p) => ({
    text: `La ruta ${repoPath(p)} no existe.`,
    next: {
      label: "Repite con una ruta válida",
      command: "togi repo add <owner/repo> --path <ruta>",
    },
  }),
  not_a_git_repo: (p) => ({
    text: `${repoPath(p)} no es la raíz de un repo git.`,
    next: { label: "Indica la carpeta que contiene .git" },
  }),
  remote_mismatch: (p) => ({
    text: `Ningún remote de ${repoPath(p)} apunta a ${repoName(p)}.`,
    next: { label: "Revisa los remotes con", command: "git -C <ruta> remote -v" },
  }),
  inside_togi_home: (p) => ({
    text: `${repoPath(p)} está dentro del directorio de datos de togi.`,
    next: { label: "Registra un clon fuera de él" },
  }),
  repo_already_registered: (p) => ({
    text: `${repoName(p)} ya está registrado.`,
    next: { label: "Míralo con", command: "togi repo list" },
  }),
  repo_not_found: (p) => ({ text: `${repoName(p)} no está registrado.`, next: listRepos }),
  auth_api_key_saved: () => ({ text: "Clave de API guardada · modo api-key" }),
  auth_subscription_saved: () => ({ text: "Token de suscripción guardado · modo subscription" }),
  auth_status_api_key: () => ({ text: "Modo activo: clave de API" }),
  auth_status_subscription: () => ({ text: "Modo activo: suscripción" }),
  auth_status_none: () => ({
    text: "Sin credencial del agente.",
    next: { label: "Guarda una con", command: "togi auth set-api-key" },
  }),
  credentials_inconsistent: () => ({
    text: "Quedan las credenciales de los dos modos y no se elige ninguno.",
    next: { label: "Repite el cambio con", command: "togi auth set-api-key" },
  }),
  secret_empty: (p) => ({
    text: "No ha llegado ningún secreto por la entrada estándar.",
    next: { label: "Mira el uso con", command: p.command ?? "togi auth --help" },
  }),
  secret_too_long: (p) => ({
    text: "El secreto es demasiado largo.",
    next: { label: "Mira el uso con", command: p.command ?? "togi auth --help" },
  }),
  secret_input_refused: () => ({
    text: "Esta terminal no puede ocultar lo que escribes, así que no se lee el secreto.",
    next: { label: "Pásalo por tubería", command: "pbpaste | togi auth set-api-key" },
  }),
  secret_cancelled: () => ({ text: "Cancelado. No se ha guardado nada." }),
  unknown_option: (p) => ({
    text: `Opción desconocida${p.field === undefined ? "" : `: ${plain(p.field, "?")}`}.`,
    next: { label: "Mira las opciones con", command: p.command ?? "togi --help" },
  }),
  option_value_missing: (p) => ({
    text: `Falta el valor de ${p.field === undefined ? "una opción" : plain(p.field, "?")}.`,
    next: { label: "Mira el uso con", command: p.command ?? "togi --help" },
  }),
  option_value_ambiguous: (p) => ({
    text: `El valor de ${p.field === undefined ? "una opción" : plain(p.field, "?")} empieza por «-» y se confunde con otra opción: escríbelo con =, por ejemplo ${p.field === undefined ? "--opción" : plain(p.field, "?")}=-valor.`,
    next: { label: "Mira el uso con", command: p.command ?? "togi --help" },
  }),
  option_value_unexpected: (p) => ({
    text: `${p.field === undefined ? "Una opción" : plain(p.field, "?")} no admite un valor.`,
    next: { label: "Mira el uso con", command: p.command ?? "togi --help" },
  }),
  invalid_usage: (p) => ({
    text: "Uso incorrecto.",
    next: { label: "Mira el uso con", command: p.command ?? "togi --help" },
  }),
  usage: (p) => ({
    text: p.command ?? "Uso incorrecto.",
    next: { label: "Mira el uso con", command: "togi --help" },
  }),
};

export const unexpected = (status: number): Message => ({
  text: `Error inesperado (HTTP ${status}).`,
});
