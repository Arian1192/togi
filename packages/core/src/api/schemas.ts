import { z } from "zod";
import { REASON_CATEGORIES, RISK_LEVELS } from "../model/task.ts";

const title = z.string().min(3).max(120);
/**
 * `baseBranch` acabará como argumento de git: solo letras, números, `.`, `_`, `/` y `-`; no empieza
 * por `-` (sería una opción) ni por `/`, no termina en `/` y no contiene `..`.
 */
export const BASE_BRANCH_MAX = 100;
const baseBranch = z
  .string()
  .min(1)
  .max(BASE_BRANCH_MAX)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((b) => !b.startsWith("-") && !b.startsWith("/") && !b.endsWith("/") && !b.includes(".."));
/**
 * `owner/repo`: cada parte con letras, números, `.`, `_` y `-`, pero sin empezar por `-` ni por `.`
 * (así ninguna parte puede ser una opción, `.` ni `..`).
 */
const repo = z.string().regex(/^\w[\w.-]*\/\w[\w.-]*$/);
const longText = z.string().max(20_000);

export const CreateTask = z.object({
  title,
  description: longText.default(""),
  acceptanceCriteria: longText.default(""),
  risk: z.enum(RISK_LEVELS),
  repo,
  baseBranch: baseBranch.default("dev"),
});

/** `path` absoluto: el daemon no conoce el directorio desde el que trabaja la CLI. */
export const RegisterRepo = z.object({ repo, path: z.string().regex(/^\/.+/) });

export const EditTask = z
  .object({
    title: title.optional(),
    description: longText.optional(),
    acceptanceCriteria: longText.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "al menos un campo",
  });

export const RejectTask = z.object({
  reason: z.object({ category: z.enum(REASON_CATEGORIES), text: z.string().min(1).max(5_000) }),
});

/** El número del PR lo da el humano; togi no lo verifica. */
export const CompleteTask = z.object({ prNumber: z.number().int().positive() });

export type CreateTask = z.infer<typeof CreateTask>;
export type CompleteTask = z.infer<typeof CompleteTask>;
export type RegisterRepo = z.infer<typeof RegisterRepo>;
export type EditTask = z.infer<typeof EditTask>;
export type RejectTask = z.infer<typeof RejectTask>;

export const AGENT_CREDENTIAL_MODES = ["api-key", "subscription"] as const;

/** El secreto va en el cuerpo y nunca sale de vuelta: ASCII imprimible sin comillas ni `\`. */
export const SetAgentCredential = z.object({
  mode: z.enum(AGENT_CREDENTIAL_MODES),
  secret: z
    .string()
    .min(8)
    .max(512)
    .regex(/^[\x21-\x7e]+$/)
    .refine((s) => !/["'\\]/.test(s)),
});
