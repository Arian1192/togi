import { z } from "zod";
import { REASON_CATEGORIES, RISK_LEVELS } from "../model/task.ts";

const title = z.string().min(3).max(120);
const longText = z.string().max(20_000);

export const CreateTask = z.object({
  title,
  description: longText.default(""),
  acceptanceCriteria: longText.default(""),
  risk: z.enum(RISK_LEVELS),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  baseBranch: z.string().default("dev"),
});

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

export type CreateTask = z.infer<typeof CreateTask>;
export type EditTask = z.infer<typeof EditTask>;
export type RejectTask = z.infer<typeof RejectTask>;
