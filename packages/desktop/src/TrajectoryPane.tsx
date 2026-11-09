import { useCallback, useEffect, useRef, useState } from "react";
import { applyPage, INITIAL, pageRequest, type TrajectoryState } from "./Trajectory.ts";
import { TrajectorySection } from "./TrajectorySection.ts";
import { readTrajectory } from "./trajectoryApi.ts";

/**
 * Lee la trayectoria de la tarea al abrirla y, si está abierta, cada vez que cambia la tarea (su
 * versión): así aparece la sesión que nace al aprobar el plan y lo nuevo de una sesión en curso.
 * Cada lectura sigue desde el cursor; si Rust dice que la sesión ya es otra, se relee desde 0.
 */
export function TrajectoryPane({ number, version }: { number: number; version: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TrajectoryState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const current = useRef(state);
  current.current = state;
  const latest = useRef(0);
  // Una sola lectura a la vez (un doble clic llega antes de que `disabled` se pinte); lo que se pida
  // mientras, se lee al acabar.
  const reading = useRef(false);
  const again = useRef(false);

  const load = useCallback(() => {
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    setBusy(true);
    const mine = latest.current;
    const { after, mark } = pageRequest(current.current);
    readTrajectory(number, after, mark)
      // Con la marca a null Rust nunca responde session_changed: la relectura no puede repetirse.
      .then(async (result) =>
        result.status === "session_changed"
          ? { base: INITIAL, page: await readTrajectory(number, 0, null) }
          : { base: null, page: result },
      )
      .then(({ base, page }) => {
        if (latest.current !== mine) return;
        const next = applyPage(base ?? current.current, page);
        current.current = next;
        setState(next);
        reading.current = false;
        setBusy(false);
        if (again.current) {
          again.current = false;
          load();
        }
      });
  }, [number]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` solo dispara la relectura.
  useEffect(() => {
    if (open) load();
  }, [open, version, load]);

  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );

  return (
    <TrajectorySection
      open={open}
      state={state}
      busy={busy}
      onToggle={() => setOpen((prev) => !prev)}
      onMore={load}
      onRefresh={load}
    />
  );
}
