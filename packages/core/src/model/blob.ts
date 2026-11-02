export const DATA_CLASSES = [
  "task_text",
  "untrusted_input",
  "trajectory",
  "gate_evidence",
  "prompt",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export interface BlobRef {
  hash: `sha256:${string}`;
  keyId: string;
  dataClass: DataClass;
}
