export const DOMAIN_ERROR_CODES = [
  "task_already_exists",
  "task_not_found",
  "invalid_state",
  "task_final",
  "missing_acceptance_criteria",
  "missing_risk",
  "invalid_reason",
  "empty_edit",
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
