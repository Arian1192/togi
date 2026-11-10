import type { BlobRef } from "./blob.ts";
import type { GateRunId, WorkspaceId } from "./ids.ts";

// La rebanada 3, construir y verificar (ADR-001, ADR-004, ADR-011): la copia de trabajo de la tarea,
// lo que entrega el builder y lo que dice cada gate. Sin infraestructura: solo los datos de los eventos.

/**
 * La copia de trabajo de una tarea: un clon propio de togi, con el directorio de git fuera del árbol
 * que ve el sandbox (ADR-011 §3).
 */
export interface Workspace {
  workspaceId: WorkspaceId;
  kind: "clone";
  /** Dónde está, para togi; el agente nunca la recibe como texto suyo. */
  ref: string;
  branch: string;
  baseSha: string;
}

/** Los gates de las capas 1 y 2 (ADR-004, más `protected_paths` del ADR-011 §9). */
export const GATE_IDS = [
  "plan_contract",
  "test_integrity",
  "protected_paths",
  "diff_size",
  "typecheck",
  "lint",
  "test",
] as const;
export type GateId = (typeof GATE_IDS)[number];

/** Los gates del contrato: comprueban el diff, no el código, y se exigen siempre. */
export const CONTRACT_GATES = [
  "plan_contract",
  "test_integrity",
  "protected_paths",
  "diff_size",
] as const satisfies readonly GateId[];

/** `error`: el gate no pudo ejecutarse (por ejemplo, falló la instalación). Nunca cuenta como pasado. */
export const GATE_STATUSES = ["pass", "fail", "error"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

/** Lo que registra togi de cada gate en un ciclo. */
export interface GateRun {
  gateRunId: GateRunId;
  cycle: number;
  /** El commit verificado: el que entregó el builder en este ciclo. */
  headSha: string;
  gate: GateId;
  status: GateStatus;
  /** Frase corta escrita por togi, nunca salida del repo ni del agente: esa va en `evidence`. */
  summary: string;
  evidence: BlobRef | null;
  durationMs: number;
}

/** Lo que sabe de la construcción la vista de la tarea. Ausente equivale a NO_BUILDING. */
export interface BuildingView {
  /** El ciclo `building` → `verifying` en curso; empieza en 1 (ADR-001: como máximo 3). */
  cycle: number;
  workspaceId: WorkspaceId | null;
  /** El commit entregado en este ciclo, si ya lo hay. */
  headSha: string | null;
  /** El resultado de cada gate en este ciclo. */
  gates: Partial<Record<GateId, { gateRunId: GateRunId; status: GateStatus }>>;
  workspaceReleased?: boolean;
  failureClassified?: boolean;
}

export const NO_BUILDING: BuildingView = { cycle: 1, workspaceId: null, headSha: null, gates: {} };
