import type { BlobRef } from "./blob.ts";

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const TASK_STATES = [
  "draft",
  "planning",
  "plan_review",
  "building",
  "verifying",
  "review",
  "merged",
  "failed",
  "rejected",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const REASON_CATEGORIES = [
  "misunderstanding",
  "scope",
  "logic",
  "tests",
  "style",
  "other",
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export interface Reason {
  category: ReasonCategory;
  text: BlobRef;
}

export type TaskSource =
  | { kind: "cli" }
  | { kind: "github_issue"; repo: string; number: number; url: string; untrustedBody: BlobRef };
