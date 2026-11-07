import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
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

/** Estado del daemon y lista de tareas. Sin datos viejos: si deja de responder, lo dice y suelta ambos. */
export function App() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [list, setList] = useState<TaskResult | null>(null);

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
      {list?.status === "ok" && <TaskList tasks={list.tasks} truncated={list.truncated} />}
    </main>
  );
}
