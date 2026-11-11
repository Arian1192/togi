export const DOMAIN_ERROR_CODES = [
  "task_already_exists",
  "task_not_found",
  "invalid_state",
  "task_final",
  "missing_acceptance_criteria",
  "missing_risk",
  "invalid_reason",
  "empty_edit",
  "session_already_active",
  "no_active_session",
  "not_session_actor",
  "actor_not_allowed",
  "stale_plan_version",
  "plan_exceeds_limits",
  "invalid_session_role",
  "missing_failure_reason",
  "invalid_specialist",
  "specialist_version_conflict",
  "invalid_payload",
  "workspace_already_exists",
  "workspace_mismatch",
  "stale_cycle",
] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainError {
  readonly kind: "domain_error";
  readonly code: DomainErrorCode;
  readonly message: string;
}

export const domainError = (code: DomainErrorCode, message: string): DomainError => ({
  kind: "domain_error",
  code,
  message,
});

export const isDomainError = <T>(result: T | DomainError): result is DomainError =>
  !Array.isArray(result);
