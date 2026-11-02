export type TaskId = number;
export type SessionId = `ses_${string}`;
export type WorkspaceId = `wsp_${string}`;
export type GateRunId = `gr_${string}`;
export type UserId = `usr_${string}`;

export const AGENT_ROLES = ["planner", "builder", "reviewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export type Actor =
  | { kind: "human"; userId: UserId }
  | { kind: "agent"; sessionId: SessionId; role: AgentRole }
  | { kind: "system"; component: "gates" | "integrator" | "merger" | `adapter:${string}` };
