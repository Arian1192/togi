import type { BlobRef, BlobStore, DataClass, TaskId } from "@togi/core";
import { DISCARDED, MAX_REDACT_CHARS, redact } from "../redaction/redact.ts";

/** Clases que pasan por el detector antes de guardarse (ADR-004). */
const REDACTED_CLASSES: ReadonlySet<DataClass> = new Set(["trajectory", "gate_evidence", "prompt"]);

/**
 * Limpia los secretos de cada blob de esas clases antes de cifrarlo y guardarlo. Es un decorador:
 * quien escribe un prompt o un payload de trayectoria no puede olvidarse de limpiar.
 */
export class RedactingBlobStore implements BlobStore {
  readonly #inner: BlobStore;
  readonly #literals: readonly string[];

  /** `literals`: valores exactos que nunca deben guardarse (el token de togi). */
  constructor(inner: BlobStore, literals: readonly string[] = []) {
    this.#inner = inner;
    this.#literals = literals;
  }

  put(bytes: Uint8Array, dataClass: DataClass, taskId: TaskId): Promise<BlobRef> {
    if (!REDACTED_CLASSES.has(dataClass)) return this.#inner.put(bytes, dataClass, taskId);
    // Un blob de 4 bytes por carácter como máximo: más que eso se descarta sin decodificarlo.
    const text =
      bytes.byteLength > MAX_REDACT_CHARS * 4 ? DISCARDED : new TextDecoder().decode(bytes);
    return this.#inner.put(
      new TextEncoder().encode(redact(text, this.#literals)),
      dataClass,
      taskId,
    );
  }

  get(ref: BlobRef): Promise<Uint8Array> {
    return this.#inner.get(ref);
  }

  shred(keyId: string): Promise<void> {
    return this.#inner.shred(keyId);
  }
}
