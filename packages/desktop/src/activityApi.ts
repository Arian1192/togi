import { invoke } from "@tauri-apps/api/core";
import type {
  AgentRole,
  FailureReason,
  GateId,
  GateStatus,
  PlanDecision,
  SessionOutcome,
  TaskEvent,
} from "@togi/core";

// El comando de Tauri de la pestaña Actividad (ADR-010 §3). El `invoke` lleva su nombre escrito: así
// frontend-boundary.test.ts lo ve y la lista de comandos permitidos sigue cerrada. El webview solo
// pasa el número de tarea; Rust devuelve de cada evento su tipo, su actor y campos cerrados, nunca
// texto libre ni contenido (§8). Los estados no viajan: salen de `stateAfter` de @togi/core con el
// `verdict` y el `passed` de cada movimiento (§1).

export type ActivityActor =
  | { kind: "human" }
  | { kind: "agent"; role: AgentRole }
  | { kind: "system"; component: string };

export interface ActivityUsage {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/** Un movimiento. Cada campo opcional solo aparece en los tipos que lo llevan. */
export interface ActivityItem {
  seq: number;
  at: string;
  type: TaskEvent["type"];
  actor: ActivityActor;
  /** `session.started`. `specialist` y `runtime` van como `id@versión`. */
  role?: AgentRole;
  specialist?: string;
  runtime?: string;
  model?: string;
  /** `session.started` y `session.ended`. */
  sessionId?: string;
  /** `session.ended`. */
  outcome?: SessionOutcome;
  failureReason?: FailureReason | null;
  usage?: ActivityUsage;
  /** `decision.recorded`. */
  verdict?: PlanDecision["verdict"];
  /** `gate.completed`. */
  gate?: GateId;
  status?: GateStatus;
  durationMs?: number;
  /** `gate.completed`, `build.submitted`, `verification.completed` y `task.failed`. */
  cycle?: number;
  /** `build.submitted` y `verification.completed`: los 7 primeros caracteres. */
  headSha?: string;
  /** `verification.completed`. */
  passed?: boolean;
}

/** `truncated`: había más movimientos y faltan los más antiguos. */
export type ActivityResult =
  | { status: "ok"; items: ActivityItem[]; truncated: boolean }
  | { status: "unreachable"; reason: string };

/** Los movimientos de la tarea, del más antiguo al más reciente; un fallo al invocar es un motivo cerrado. */
export function readTaskActivity(number: number): Promise<ActivityResult> {
  return invoke<ActivityResult>("read_task_activity", { number }).catch(
    (): ActivityResult => ({ status: "unreachable", reason: "app" }),
  );
}
