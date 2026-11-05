import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalize } from "../integrity/canonicalize.ts";
import { AGENT_ROLES, type AgentRole } from "./ids.ts";

/**
 * Herramientas que admite cada rol (ADR-009): el rol fija el poder, el especialista solo elige
 * dentro. Única fuente: el worker importa de aquí. Un rol sin herramientas no admite ninguna hasta
 * que un ADR decida las suyas.
 */
export const ROLE_TOOLS = {
  planner: ["Read", "Glob", "Grep"],
  builder: [],
  reviewer: [],
} as const satisfies Record<AgentRole, readonly string[]>;

export const SPECIALIST_STREAM_PREFIX = "specialist:";
export const specialistStream = (id: string) => `${SPECIALIST_STREAM_PREFIX}${id}`;

/** Formato de un especialista (ADR-009). Se rechaza al publicarlo y al leerlo si pide más que su rol. */
export const SpecialistSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    version: z.number().int().positive(),
    role: z.enum(AGENT_ROLES),
    runtime: z.string().min(1),
    model: z.string().min(1),
    tools: z.array(z.string()),
    instructions: z.string().min(1),
  })
  .superRefine((spec, ctx) => {
    const allowed: readonly string[] = ROLE_TOOLS[spec.role];
    const extra = spec.tools.filter((tool) => !allowed.includes(tool));
    if (extra.length > 0) {
      const message = `el rol ${spec.role} no admite las herramientas: ${extra.join(", ")}`;
      ctx.addIssue({ code: "custom", path: ["tools"], message });
    }
  });
export type Specialist = z.infer<typeof SpecialistSchema>;

export type SpecialistHash = `sha256:${string}`;

/** sha256 del JSON canónico (RFC 8785) del contenido: no depende del orden de las claves. */
export function specialistHash(spec: Specialist): SpecialistHash {
  return `sha256:${createHash("sha256").update(canonicalize(spec)).digest("hex")}`;
}
