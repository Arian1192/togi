import { createHash } from "node:crypto";
import type { EventEnvelope } from "../model/events.ts";
import { canonicalize } from "./canonicalize.ts";

export const GENESIS_HASH = "0".repeat(64);

/** sha256(prevHash || JSON canónico del envelope), hex en minúsculas, sin prefijo `sha256:`. */
export function hashEvent(prevHash: string, envelope: EventEnvelope<string, unknown>): string {
  if ((envelope.correlationId as unknown) === null) {
    throw new TypeError("hashEvent: correlationId ausente se representa sin el campo, no con null");
  }
  const { seq, stream, streamVersion, type, schemaVersion, actor, at, correlationId, payload } =
    envelope;
  const canonical = canonicalize({
    seq,
    stream,
    streamVersion,
    type,
    schemaVersion,
    actor,
    at,
    correlationId,
    payload,
  });
  return createHash("sha256")
    .update(prevHash + canonical, "utf8")
    .digest("hex");
}
