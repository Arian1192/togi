import type { StoredEvent } from "../ports/event-store.ts";
import { GENESIS_HASH, hashEvent } from "./hash.ts";

export type ChainVerdict = { ok: true } | { ok: false; brokenAt: number };

/**
 * Verifica la cadena evento a evento, sin cargarla en memoria. El n-ésimo evento debe tener
 * seq n; `brokenAt` es el seq esperado del primero que falla. No detecta truncados al final.
 */
export async function verifyChain(
  events: Iterable<StoredEvent> | AsyncIterable<StoredEvent>,
): Promise<ChainVerdict> {
  let expectedSeq = 1;
  let prevHash = GENESIS_HASH;
  for await (const event of events) {
    const intact =
      event.seq === expectedSeq &&
      event.prevHash === prevHash &&
      event.hash === hashEvent(event.prevHash, event);
    if (!intact) return { ok: false, brokenAt: expectedSeq };
    prevHash = event.hash;
    expectedSeq += 1;
  }
  return { ok: true };
}
