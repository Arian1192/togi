import { createClient } from "../client.ts";
import { CliError } from "../errors.ts";
import { say } from "../format.ts";
import type { Output } from "../output.ts";
import type { RunContext } from "./index.ts";
import { currentPlanText } from "./plan.ts";

interface Session {
  state: string;
  outcome: string | null;
  failureReason: string | null;
}

export interface FollowOptions {
  /** Cuántas sesiones tenía la tarea antes de empezar a seguirla; solo cuentan las posteriores. */
  baseline?: number;
  /** Cuánto esperar a que empiece una sesión antes de rendirse. */
  sessionWaitMs?: number;
  pollMs?: number;
}

export const SESSION_WAIT_MS = 15_000;
const POLL_MS = 400;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });

/**
 * Sigue una tarea que está planificándose hasta que hay plan o falla la sesión, y lo cuenta con el
 * lenguaje de `togi plan show`. Lee el estado de la API (sesiones y plan) en lugar de fiarse de los
 * eventos: no se pierde nada de lo ocurrido antes de empezar a seguir. Si no empieza ninguna sesión
 * en `sessionWaitMs`, lo dice y sale con 1 en vez de esperar sin fin: puede estar en cola tras otra
 * tarea o haber fallado el orquestador sin abrir sesión. Ctrl+C solo deja de seguir.
 */
export async function followTask(
  { home, out, write, signal }: Pick<RunContext, "home" | "out" | "write" | "signal">,
  n: string,
  { baseline, sessionWaitMs = SESSION_WAIT_MS, pollMs = POLL_MS }: FollowOptions = {},
): Promise<string> {
  const client = createClient(home);
  const read = async () =>
    (
      await client.checked<{ sessions: Session[] }>(
        await client.api.v1.tasks[":n"].sessions.$get({ param: { n } }),
        { n: Number(n) },
      )
    ).sessions;
  const from = baseline ?? (await read()).length;
  const started = Date.now();
  let announced = false;
  write(`${say("follow_waiting", { n: Number(n) })}\n`);
  while (!signal.aborted) {
    const last = (await read()).slice(from).at(-1);
    if (last === undefined) {
      if (Date.now() - started >= sessionWaitMs) throw await noSession(client, n, sessionWaitMs);
    } else {
      if (!announced) write(`${say("follow_session_started", { n: Number(n) })}\n`);
      announced = true;
      if (last.state === "ended") {
        if (last.outcome === "completed") return ready(client, n, out);
        throw new CliError("follow_session_failed", 1, {
          n: Number(n),
          reason: last.failureReason ?? "",
        });
      }
    }
    await sleep(pollMs, signal);
  }
  return `${say("follow_stopped", { n: Number(n) })}\n`;
}

async function ready(client: ReturnType<typeof createClient>, n: string, out: Output) {
  const plan = await currentPlanText(client, n, out);
  return `${plan}\n${say("follow_plan_ready", { n: Number(n) })}\n`;
}

/** El error de «no empezó ninguna sesión», con el estado del planificador si no está activo. */
async function noSession(client: ReturnType<typeof createClient>, n: string, waitedMs: number) {
  const planner = await client
    .checked<{ state: string; reason: string }>(await client.api.v1.planner.$get())
    .catch(() => undefined);
  return new CliError("follow_no_session", 1, {
    n: Number(n),
    ...(planner === undefined || planner.state === "active"
      ? {}
      : { state: planner.state, detail: planner.reason }),
    seconds: Math.round(waitedMs / 1000),
  });
}
