import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { MesaScreen } from "./MesaView.ts";
import { applyHeader, EMPTY, type Header, type MesaState, seed } from "./mesa.ts";
import { readTrajectory } from "./trajectoryApi.ts";

type DaemonEvent = { kind: "open" } | { kind: "task" } | { kind: "closed" };
type SessionTag = { seq: number; session: string };

/**
 * La mesa en vivo con sus datos. Al abrirla (y al reconectar, cuando lo anterior pudo perderse) se
 * siembra con las tareas en planning cuya sesión sigue activa de verdad, no solo por su estado; luego
 * suma cada cabecera que llega, con la etiqueta de su sesión. Si el daemon se cae, se vacía: no se
 * enseñan datos viejos como si fueran actuales (ADR-010 §1).
 */
export function MesaPane({ planning, waiting }: { planning: number[]; waiting: number }) {
  const [state, setState] = useState<MesaState>(EMPTY);
  const tags = useRef(new Map<number, string>());
  const wanted = useRef(planning);
  wanted.current = planning;

  useEffect(() => {
    let live = true;
    const sow = async () => {
      const found = await Promise.all(
        wanted.current.map((n) =>
          readTrajectory(n, 0, null).then((r) =>
            r.status === "ok" && r.sessionState === "active" ? n : null,
          ),
        ),
      );
      const active = found.filter((n): n is number => n !== null);
      if (live) setState((prev) => ({ ...seed(active, prev.lastSeq), log: prev.log ?? [] }));
    };
    const stops = [
      listen<SessionTag>("daemon-event-session", ({ payload }) => {
        tags.current.set(payload.seq, payload.session);
      }),
      listen<Header>("daemon-event-header", ({ payload }) => {
        const session = tags.current.get(payload.seq);
        tags.current.delete(payload.seq);
        setState((prev) =>
          applyHeader(prev, session === undefined ? payload : { ...payload, session }),
        );
      }),
      listen<DaemonEvent>("daemon-event", ({ payload }) => {
        if (payload.kind === "open") void sow();
        if (payload.kind === "closed") setState(EMPTY);
      }),
    ];
    void sow();
    return () => {
      live = false;
      for (const stop of stops) stop.then((f) => f());
    };
  }, []);

  return <MesaScreen state={state} waiting={waiting} />;
}
