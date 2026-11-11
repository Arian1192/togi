import { CONTRACT_GATES, type GateId, NO_BUILDING } from "../model/building.ts";
import type { GateRunId } from "../model/ids.ts";
import { REASON_CATEGORIES } from "../model/task.ts";
import type { TaskCommand } from "./commands.ts";
import { checked } from "./decide-building.ts";
import { type DomainError, domainError } from "./errors.ts";
import type { FlowPolicy } from "./policy.ts";
import type { NewTaskEvent, TaskView } from "./task-view.ts";

// La verificación (ADR-004 §1, ADR-011 §9) y lo que viene tras un estado final. Solo un `fail` gasta
// ciclo: un `error` es de infraestructura y obliga a repetir el gate sin cerrar el ciclo.

type VerifyCommand = Extract<
  TaskCommand,
  { type: "recordGate" | "completeVerification" | "classifyFailure" | "releaseWorkspace" }
>;
type Meta = Pick<NewTaskEvent, "schemaVersion" | "actor" | "at">;

const FINAL = ["merged", "failed", "rejected"];

export function decideVerification(
  view: Extract<TaskView, { exists: true }>,
  cmd: VerifyCommand,
  meta: Meta,
  policy: FlowPolicy,
): NewTaskEvent[] | DomainError {
  const kind = cmd.type === "classifyFailure" ? "human" : "system";
  if (cmd.actor.kind !== kind) {
    return domainError("actor_not_allowed", `este comando exige actor ${kind}`);
  }
  const b = view.building ?? NO_BUILDING;
  const stale = (cycle: number) =>
    cycle === b.cycle ? null : domainError("stale_cycle", `el ciclo en curso es el ${b.cycle}`);
  const notVerifying = () => domainError("invalid_state", "solo se verifica en verifying");

  switch (cmd.type) {
    case "recordGate": {
      if (view.state !== "verifying") return notVerifying();
      const { run } = cmd;
      const error = stale(run.cycle);
      if (error) return error;
      if (run.headSha !== b.headSha) {
        return domainError("head_mismatch", "el gate no es del commit entregado en este ciclo");
      }
      // Un gate que no pudo ejecutarse se repite; uno que dio resultado, no.
      const prior = b.gates[run.gate];
      if (prior && prior.status !== "error") {
        return domainError("gate_already_recorded", `el gate ${run.gate} ya está en este ciclo`);
      }
      return checked({ ...meta, type: "gate.completed", payload: run });
    }
    case "completeVerification": {
      if (view.state !== "verifying") return notVerifying();
      const error = stale(cmd.cycle);
      if (error) return error;
      const required: GateId[] = [...new Set([...CONTRACT_GATES, ...cmd.checks])];
      const missing = required.filter((g) => !b.gates[g]);
      if (missing.length > 0) {
        return domainError("missing_gates", `faltan gates: ${missing.join(", ")}`);
      }
      const runs = required.map((g) => b.gates[g]).filter((r) => r !== undefined);
      const failedGates: GateRunId[] = runs
        .filter((r) => r.status === "fail")
        .map((r) => r.gateRunId);
      if (failedGates.length === 0 && runs.some((r) => r.status === "error")) {
        return domainError("gate_errors", "hay gates que no pudieron ejecutarse: se repiten");
      }
      const headSha = b.headSha ?? "";
      const passed = failedGates.length === 0;
      const done = checked({
        ...meta,
        type: "verification.completed",
        payload: { cycle: b.cycle, headSha, passed },
      });
      if (passed || b.cycle < policy.maxFailedCycles || !Array.isArray(done)) return done;
      return [...done, { ...meta, type: "task.failed", payload: { cycle: b.cycle, failedGates } }];
    }
    case "classifyFailure": {
      if (view.state !== "failed") {
        return domainError("invalid_state", "solo se clasifica una tarea failed");
      }
      if (b.failureClassified) {
        return domainError("failure_already_classified", "el fallo ya está clasificado");
      }
      const { category, text } = cmd.reason;
      if (!REASON_CATEGORIES.includes(category) || !text) {
        return domainError("invalid_reason", "el motivo exige categoría válida y texto");
      }
      return [{ ...meta, type: "failure.classified", payload: { reason: { category, text } } }];
    }
    case "releaseWorkspace": {
      if (!FINAL.includes(view.state)) {
        return domainError("invalid_state", "la copia se libera en un estado final");
      }
      if (!b.workspaceId || cmd.workspaceId !== b.workspaceId) {
        return domainError("workspace_mismatch", "no es la copia de trabajo de la tarea");
      }
      if (b.workspaceReleased) {
        return domainError("workspace_already_released", "la copia ya está liberada");
      }
      return checked({
        ...meta,
        type: "workspace.released",
        payload: { workspaceId: b.workspaceId },
      });
    }
    default: {
      const unhandled: never = cmd;
      return unhandled;
    }
  }
}
