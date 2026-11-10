import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { MesaPane } from "./MesaPane.tsx";
import { ProjectColumn } from "./ProjectColumn.ts";
import { ProjectSummary } from "./ProjectSummary.ts";
import { buildProjects } from "./projects.ts";
import { mergeRows, TaskList, type TaskRow } from "./TaskList.ts";
import { TaskNotebookPane } from "./TaskNotebookPane.tsx";
import { TitleBar } from "./TitleBar.ts";
import {
  isToggleShortcut,
  PENDING,
  tasksFor,
  toggled,
  type View,
  viewShortcut,
} from "./viewState.ts";

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
  const [view, setView] = useState<View>(PENDING);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Rust avisa al entrar y salir de pantalla completa (lib.rs): la barra deja de reservar sitio a
  // los semáforos, que macOS oculta.
  useEffect(() => {
    let live = true;
    const unlisten = listen<boolean>("window-fullscreen", ({ payload }) => setFullscreen(payload));
    unlisten.then((stop) => !live && stop());
    return () => {
      live = false;
      unlisten.then((stop) => stop());
    };
  }, []);

  // ⌘\ pliega y despliega la columna; ⌘1 y ⌘2 cambian entre las tareas y la mesa en vivo. Atajos del
  // webview: no pasan por Tauri.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const next = viewShortcut(e);
      if (next !== null) {
        e.preventDefault();
        setView(next);
        return;
      }
      if (!isToggleShortcut(e)) return;
      e.preventDefault();
      setCollapsed((prev) => !prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const projects = useMemo(
    () => (list?.status === "ok" ? buildProjects(list.tasks, list.truncated) : null),
    [list],
  );
  // El resumen del proyecto elegido; si ya no existe (la lista se recargó), la lista vacía de siempre.
  // La tarea elegida: su cuaderno. Si ya no está en la lista, la lista vacía de siempre.
  const opened =
    view.kind === "task" && list?.status === "ok"
      ? list.tasks.find((t) => t.number === view.number)
      : undefined;
  const shown =
    view.kind === "project" ? projects?.projects.find((p) => p.repo === view.repo) : undefined;
  return (
    <div className="workbench">
      <TitleBar
        collapsed={collapsed && projects !== null}
        onCollapse={() => setCollapsed((prev) => !prev)}
        fullscreen={fullscreen}
        mesa={view.kind === "mesa"}
        onMesa={(open) => setView(open ? { kind: "mesa" } : PENDING)}
      />
      {/* Siempre montada: si el daemon deja de responder no hay lista, pero el estado se sigue viendo. */}
      <ProjectColumn
        data={projects}
        view={view}
        closed={closed}
        onView={setView}
        onToggle={(repo) => setClosed((prev) => toggled(prev, repo))}
        collapsed={collapsed && projects !== null}
        head={
          <div className="logo">
            <Monogram />
            <span>togi</span>
          </div>
        }
        foot={<p role="status">{text}</p>}
      />
      <main className="shell">
        {list?.status === "ok" ? (
          view.kind === "mesa" ? (
            <MesaPane
              planning={list.tasks.filter((t) => t.state === "planning").map((t) => t.number)}
              waiting={projects?.pending.length ?? 0}
            />
          ) : shown !== undefined ? (
            <ProjectSummary project={shown} partial={list.truncated} />
          ) : opened !== undefined ? (
            <TaskNotebookPane
              key={opened.number}
              number={opened.number}
              state={opened.state}
              version={opened.version}
            />
          ) : (
            <TaskList tasks={tasksFor(view, list.tasks)} truncated={list.truncated} />
          )
        ) : (
          <p className="muted">Sin lista de tareas.</p>
        )}
      </main>
    </div>
  );
}
