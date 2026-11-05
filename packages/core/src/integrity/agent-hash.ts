import { createHash } from "node:crypto";
import { canonicalize } from "./canonicalize.ts";
import { GENESIS_HASH } from "./hash.ts";
import type { ChainVerdict } from "./verify.ts";

export const AGENT_EVENT_KINDS = [
  "tool_call",
  "tool_result",
  "message",
  "denied",
  "usage",
] as const;
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

/** Una acción del agente (ADR-004). `payload` es el `BlobRef` serializado: nunca el contenido. */
export interface AgentEvent {
  sessionId: string;
  seq: number;
  at: string;
  kind: AgentEventKind;
  payload: string;
}

export type StoredAgentEvent = AgentEvent & { prevHash: string; hash: string };

/** sha256(prevHash || JSON canónico del evento): la cadena de cada sesión, desde su génesis. */
export function hashAgentEvent(prevHash: string, event: AgentEvent): string {
  const { sessionId, seq, at, kind, payload } = event;
  return createHash("sha256")
    .update(prevHash + canonicalize({ sessionId, seq, at, kind, payload }), "utf8")
    .digest("hex");
}

/** Verifica la cadena de UNA sesión. `brokenAt` es el seq esperado del primero que falla. */
export function verifyAgentChain(session: Iterable<StoredAgentEvent>): ChainVerdict {
  let expectedSeq = 1;
  let prevHash = GENESIS_HASH;
  for (const event of session) {
    const intact =
      event.seq === expectedSeq &&
      event.prevHash === prevHash &&
      event.hash === hashAgentEvent(event.prevHash, event);
    if (!intact) return { ok: false, brokenAt: expectedSeq };
    prevHash = event.hash;
    expectedSeq += 1;
  }
  return { ok: true };
}
