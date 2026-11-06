import type { Client } from "./client.ts";

export interface SessionSummary {
  sessionId: string;
  outcome: string | null;
  failureReason: string | null;
}

/** La última sesión de la tarea, si terminó mal con motivo. No consultarla nunca rompe el comando. */
export async function failedSession(
  client: Client,
  n: string,
): Promise<SessionSummary | undefined> {
  try {
    const { sessions } = await client.checked<{ sessions: SessionSummary[] }>(
      await client.api.v1.tasks[":n"].sessions.$get({ param: { n } }),
    );
    const last = sessions.at(-1);
    return last?.failureReason ? last : undefined;
  } catch {
    return undefined;
  }
}
