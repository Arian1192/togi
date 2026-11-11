import { stateColor } from "@togi/core";
import { createElement, type ReactNode } from "react";
import type { ActivityResult } from "./activityApi.ts";
import {
  activityFeed,
  type SessionCard,
  type StateLine,
  usageParts,
  type VerificationCard,
} from "./activityFeed.ts";
import { since } from "./mesaTasks.ts";

// La línea de tiempo de Actividad de una tarea (ADR-010 §3, panel derecho; pantalla 4 del diseño): los
// cambios de estado son líneas con un aro del color del estado al que van, y cada aportación, de un
// agente o de togi, la misma tarjeta. Todo es nodo de texto (§8); los colores, clases de tono. Sin JSX.

const ava = (name: string, togi = false) =>
  createElement("span", { className: togi ? "mc-ava is-togi" : "mc-ava" }, name.slice(0, 1));

function State({ line, now }: { line: StateLine; now: number }): ReactNode {
  return createElement(
    "div",
    { className: "mc-st" },
    createElement("span", {
      className: `mc-ring tone-${stateColor(line.state)}`,
      "aria-hidden": true,
    }),
    createElement(
      "span",
      null,
      createElement("b", null, line.who),
      " → ",
      createElement("b", null, line.state),
    ),
    createElement("span", { className: "mc-t" }, since(line.at, now)),
    line.handoff !== null &&
      createElement(
        "span",
        { className: "mc-sub" },
        "↳ togi se la entregó a ",
        createElement("span", { className: "mc-who" }, ava(line.handoff), line.handoff),
      ),
  );
}

function Session({ card, now }: { card: SessionCard; now: number }): ReactNode {
  const run = [card.specialist, card.runtime].filter((s): s is string => s !== null);
  return createElement(
    "article",
    { className: "mc-card" },
    createElement(
      "div",
      { className: "mc-hd" },
      ava(card.role),
      createElement("b", null, card.role),
      createElement("span", { className: "mc-t" }, since(card.at, now)),
    ),
    (run.length > 0 || card.model !== null) &&
      createElement(
        "div",
        { className: "mc-runline" },
        run.map((s, i) => createElement("span", { key: i }, s)),
        card.model !== null && createElement("span", { className: "is-model" }, card.model),
      ),
    card.outcome !== null &&
      card.outcome !== "completed" &&
      createElement(
        "p",
        { className: "mc-note" },
        card.failureReason ? `${card.outcome} · ${card.failureReason}` : card.outcome,
      ),
    card.usage !== null &&
      createElement(
        "div",
        { className: "mc-usage" },
        usageParts(card.usage).map((s, i) => createElement("span", { key: i }, s)),
      ),
  );
}

/** El veredicto de una verificación: su tono de marca y cómo se lee. */
const VERDICT: Record<`${boolean | null}`, readonly [string, string]> = {
  true: ["done", "pasa"],
  false: ["human", "no pasa"],
  null: ["agent", "en curso"],
};

function Verification({ card, now }: { card: VerificationCard; now: number }): ReactNode {
  const cycle = card.cycle === null ? "" : ` el ciclo ${card.cycle}`;
  const [tone, verdict] = VERDICT[`${card.passed}`];
  const passing = card.gates.filter((g) => g.status === "pass").length;
  return createElement(
    "article",
    { className: "mc-card" },
    createElement(
      "div",
      { className: "mc-hd" },
      ava("togi", true),
      createElement("b", null, "togi"),
      createElement(
        "span",
        { className: "mc-m" },
        `${card.passed === null ? "verificando" : "verificó"}${cycle}`,
      ),
      createElement("span", { className: "mc-t" }, since(card.at, now)),
    ),
    createElement(
      "div",
      { className: "mc-runline" },
      createElement("span", null, "sin modelo · determinista"),
    ),
    createElement(
      "div",
      { className: "mc-att" },
      createElement(
        "div",
        { className: "mc-row" },
        card.headSha !== null && createElement("code", { className: "ident" }, card.headSha),
        createElement("span", { className: "mc-grow" }, `${passing} de ${card.gates.length} gates`),
        createElement("span", { className: `mc-verdict tone-${tone}` }, verdict),
      ),
      card.gates.length > 0 &&
        createElement(
          "div",
          { className: "mc-row" },
          createElement(
            "div",
            { className: "mc-chk" },
            card.gates.map((g) =>
              createElement(
                "span",
                { key: g.gate, className: `is-${g.status}` },
                g.status === "pass" ? g.gate : `${g.gate} · ${g.status}`,
              ),
            ),
          ),
        ),
    ),
  );
}

const muted = (text: string) => createElement("p", { className: "muted" }, text);

/** La actividad de una tarea; `null` mientras se lee. Si no se pudo leer, lo dice y no enseña nada. */
export function ActivityTimeline({
  result,
  now,
}: {
  result: ActivityResult | null;
  now: number;
}): ReactNode {
  if (result === null) return muted("Leyendo la actividad…");
  if (result.status !== "ok") return muted("No se pudo leer la actividad de la tarea.");
  const feed = activityFeed(result.items);
  if (feed.length === 0 && !result.truncated) return muted("Todavía no hay movimientos.");
  return [
    result.truncated &&
      createElement(
        "p",
        { key: "cut", className: "muted" },
        "Faltan los movimientos más antiguos.",
      ),
    createElement(
      "div",
      { key: "feed", className: "mc" },
      feed.map((e) => {
        const key = `${e.kind}-${e.seq}`;
        if (e.kind === "state") return createElement(State, { key, line: e, now });
        if (e.kind === "session") return createElement(Session, { key, card: e, now });
        return createElement(Verification, { key, card: e, now });
      }),
    ),
  ];
}
