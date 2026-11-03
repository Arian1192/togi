export const DATA_CLASSES = [
  "task_text",
  "untrusted_input",
  "trajectory",
  "gate_evidence",
  "prompt",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export interface BlobRef {
  /** HMAC-SHA256 del contenido en claro con una clave derivada de la clave de datos (ADR-004). */
  hash: `hmac-sha256:${string}`;
  keyId: string;
  dataClass: DataClass;
}
