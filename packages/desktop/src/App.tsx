import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

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
    <svg viewBox="0 0 64 64" width={48} height={48} role="img" aria-label="togi">
      <path
        fill="currentColor"
        d="M25 12 L35 6 L35 20 L49 20 L49 29 L35 29 L35 42 Q35 48 41 48 L49 48 L49 58 L41 58 Q25 58 25 42 L25 29 L15 29 L15 20 L25 20 Z"
      />
    </svg>
  );
}

/** Estado del daemon. Sin datos viejos: si deja de responder, lo dice y suelta la versión. */
export function App() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);

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

  const text =
    status === null
      ? "comprobando el daemon…"
      : status.state === "running"
        ? `daemon en marcha · ${status.version}`
        : `daemon sin respuesta: ${REASONS[status.reason] ?? "respuesta no válida"}`;
  return (
    <main className="shell">
      <Monogram />
      <p role="status">{text}</p>
    </main>
  );
}
