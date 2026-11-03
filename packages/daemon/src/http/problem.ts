import type { DomainErrorCode } from "@togi/core";

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  404: "Not Found",
  409: "Conflict",
  412: "Precondition Failed",
  422: "Unprocessable Content",
  428: "Precondition Required",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/** Regla del flujo → status. Solo `task_not_found` es otra cosa que 422. */
export const domainStatus = (code: DomainErrorCode): 404 | 422 =>
  code === "task_not_found" ? 404 : 422;

/** Respuesta RFC 9457 (`application/problem+json`) con el `code` estable como extensión. */
export function problem(
  status: number,
  code: string,
  detail?: string,
  headers: Record<string, string> = {},
): Response {
  const body = {
    type: "about:blank",
    title: TITLES[status] ?? "Error",
    status,
    code,
    ...(detail === undefined ? {} : { detail }),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/problem+json" },
  });
}
