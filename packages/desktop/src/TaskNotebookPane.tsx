import type { TaskState } from "@togi/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { outcomeEffect, type Review } from "./notebook.ts";
import { loadReview, sendDecision } from "./notebookApi.ts";
import type { Decision } from "./planDecision.ts";
import { TaskNotebook } from "./TaskNotebook.ts";

/**
 * Lee la tarea elegida y deja decidir sobre su plan. Se vuelve a leer cuando cambia su estado o su
 * versión (la lista se recarga con los eventos del daemon): así tras aprobar se ve ya en `building`.
 * Una lectura lenta de otra tarea, o de antes de una recarga, no pisa la pantalla actual.
 */
export function TaskNotebookPane({
  number,
  state,
  version,
}: {
  number: number;
  state: TaskState;
  version: number;
}) {
  const [review, setReview] = useState<Review>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const read = useCallback(
    (next: string | null) => {
      const mine = ++latest.current;
      setNotice(next);
      loadReview(number, state === "plan_review").then((r) => {
        if (latest.current === mine) setReview(r);
      });
    },
    [number, state],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` solo dispara la relectura.
  useEffect(() => {
    read(null);
    return () => {
      latest.current += 1;
    };
  }, [read, version]);

  const decide = (decision: Decision) => {
    if (review.status !== "ready" || review.version === null || busy) return;
    setBusy(true);
    sendDecision(number, review.version, decision)
      .catch((): { status: "failed"; reason: string } => ({ status: "failed", reason: "app" }))
      .then((out) => {
        setBusy(false);
        const effect = outcomeEffect(out);
        if (effect.kind === "reload") read(effect.notice);
        else if (effect.kind === "notice") setNotice(effect.notice);
      });
  };

  return (
    <TaskNotebook review={review} state={state} notice={notice} busy={busy} onDecide={decide} />
  );
}
