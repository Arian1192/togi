import type { FailureReason } from "@togi/core";
import type { Notification } from "../notify/notifier.ts";

/**
 * Los textos de las notificaciones. Solo llevan el número de la tarea, un código de la lista cerrada
 * y un comando: nunca el título (cifrado, ADR-004) ni texto del agente. macOS guarda un historial de
 * notificaciones que sobreviviría al borrado de la tarea.
 */
const FOLLOW: Partial<Record<FailureReason, (n: number) => string>> = {
  repo_not_registered: () => "togi repo add",
  credential_missing: () => "togi auth set-api-key",
  sandbox_unavailable: () => "togi daemon status",
};
const retry = (n: number) => `togi plan retry ${n}`;

export const planReady = (n: number): Notification => ({
  title: "togi: plan listo",
  message: `#${n} · togi plan show ${n}`,
});

export const sessionFailed = (n: number, code: FailureReason): Notification => ({
  title: "togi: sesión fallida",
  message: `#${n} · ${code} · ${(FOLLOW[code] ?? retry)(n)}`,
});

export const orchestratorFailed = (n: number): Notification => ({
  title: "togi: falló el orquestador",
  message: `#${n} · ${retry(n)}`,
});
