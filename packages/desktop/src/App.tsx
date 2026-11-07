import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type { PlanData, TaskCover } from "./PlanNotebook.ts";
import { PlanReview, type Review } from "./PlanReview.ts";
import type { Decision } from "./planDecision.ts";
import { mergeRows, TaskList, type TaskRow } from "./TaskList.ts";

type DaemonStatus =
  | { state: "running"; version: string }
  | { state: "unreachable"; reason: string };

const REASONS: Record<string, string> = {
  no_credentials: "no hay credenciales: ¿está instalado togi?",
  no_socket: "el daemon no está en marcha",
  unauthorized: "el daemon rechazó la petición",
};
const POLL_MS = 5000;

function Monogram() {
  return (
    <svg className="monogram" viewBox="0 0 64 64" aria-hidden="true">
      <path
        fill="currentColor"
        d="M25 12 L35 6 L35 20 L49 20 L49 29 L35 29 L35 42 Q35 48 41 48 L49 48 L49 58 L41 58 Q25 58 25 42 L25 29 L15 29 L15 20 L25 20 Z"
      />
    </svg>
  );
}

type TaskResult =
  | { status: "ok"; tasks: TaskRow[]; truncated: boolean }
  | { status: "unreachable"; reason: string };

/** Lo que reenvía el lado Rust del stream del daemon: un resumen, nunca el evento (ver events.rs). */
type DaemonEvent = { kind: "open" } | { kind: "task" } | { kind: "closed" };

type TaskRead = { status: "ok"; task: TaskCover } | { status: "unreachable"; reason: string };
type PlanRead =
  | { status: "ok"; plan: PlanData; version: number }
  | { status: "unreachable"; reason: string };
/** Resultado de una decisión (plan.rs): los motivos de `failed` son cerrados, nunca texto del daemon. */
type Outcome =
  | { status: "ok" | "plan_changed" | "cancelled" }
  | { status: "failed"; reason: string };

const PLAN_CHANGED = "El plan cambió mientras lo leías. Este es el nuevo: léelo antes de decidir.";

/** Lee la portada y el plan de una tarea; la versión que se manda al decidir es la del plan leído. */
async function readReview(number: number): Promise<Review> {
  const [task, plan] = await Promise.all([
    invoke<TaskRead>("read_task", { number }),
    invoke<PlanRead>("read_plan", { number }),
  ]).catch(() => [null, null] as const);
  if (task?.status === "ok" && plan?.status === "ok") {
    return { status: "ready", task: task.task, plan: plan.plan, version: plan.version };
  }
  const bad = [task, plan].find((r) => r?.status === "unreachable");
  return { status: "error", reason: bad?.status === "unreachable" ? bad.reason : "app" };
}

/** Estado del daemon y lista de tareas. Sin datos viejos: si deja de responder, lo dice y suelta ambos. */
export function App() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [list, setList] = useState<TaskResult | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [review, setReview] = useState<Review>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // La tarea que se está mirando: una lectura lenta de otra tarea no pisa la pantalla actual.
  const current = useRef<number | null>(null);
  const close = () => {
    current.current = null;
    setOpen(null);
  };
  const show = (number: number, next: string | null = null) => {
    current.current = number;
    setOpen(number);
    setNotice(next);
    setReview({ status: "loading" });
    readReview(number).then((r) => current.current === number && setReview(r));
  };
  const decide = (decision: Decision) => {
    if (open === null || review.status !== "ready" || busy) return;
    const args = { number: open, version: review.version };
    setBusy(true);
    const send = (): Promise<Outcome> => {
      if (decision.kind === "approve") return invoke<Outcome>("approve_plan", args);
      const reason = { ...args, category: decision.category, text: decision.text };
      return decision.kind === "reject"
        ? invoke<Outcome>("reject_plan", reason)
        : invoke<Outcome>("request_plan_changes", reason);
    };
    send()
      .catch((): Outcome => ({ status: "failed", reason: "app" }))
      .then((out) => {
        setBusy(false);
        if (out.status === "ok") {
          close();
        } else if (out.status === "plan_changed") {
          show(open, PLAN_CHANGED);
        } else if (out.status === "failed") {
          setNotice(`No se pudo enviar la decisión (${out.reason}). El plan sigue sin decidir.`);
        }
      });
  };

  useEffect(() => {
    let live = true;
    const poll = () =>
      invoke<DaemonStatus>("get_daemon_status")
        .then((s) => live && setStatus(s))
        .catch(() => live && setStatus({ state: "unreachable", reason: "app" }));
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  // La lista se recarga al conectar y con cada evento de una tarea, y se funde por número y versión.
  // Las recargas que llegan mientras hay una en curso se juntan en una sola.
  useEffect(() => {
    let live = true;
    let busy = false;
    let again = false;
    const refresh = (): void => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      invoke<TaskResult>("list_tasks")
        .catch((): TaskResult => ({ status: "unreachable", reason: "app" }))
        .then((next) => {
          if (live)
            setList((prev) =>
              next.status === "ok" && prev?.status === "ok"
                ? { ...next, tasks: mergeRows(prev.tasks, next.tasks) }
                : next,
            );
          busy = false;
          if (again) {
            again = false;
            refresh();
          }
        });
    };
    const unlisten = listen<DaemonEvent>("daemon-event", ({ payload }) => {
      if (payload.kind === "closed") setList(null);
      else refresh();
    }).then((stop) => {
      if (!live) {
        stop();
        return () => {};
      }
      invoke("watch_events");
      return stop;
    });
    refresh();
    return () => {
      live = false;
      unlisten.then((stop) => stop());
    };
  }, []);

  const text =
    status === null ? (
      "comprobando el daemon…"
    ) : status.state === "running" ? (
      // La versión y el commit son identificadores: van en font-mono (manual de marca, tipografía).
      <>
        daemon en marcha · <code className="ident">{status.version}</code>
      </>
    ) : (
      `daemon sin respuesta: ${REASONS[status.reason] ?? "respuesta no válida"}`
    );
  return (
    <main className="shell">
      <div className="logo">
        <Monogram />
        <span>togi</span>
      </div>
      <p role="status">{text}</p>
      {open !== null ? (
        <PlanReview review={review} notice={notice} busy={busy} onDecide={decide} onBack={close} />
      ) : (
        list?.status === "ok" && (
          <TaskList tasks={list.tasks} truncated={list.truncated} onOpen={(n) => show(n)} />
        )
      )}
    </main>
  );
}
