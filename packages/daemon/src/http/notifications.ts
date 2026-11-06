import { Hono } from "hono";
import { NOTIFY_NOT_CONFIGURED, type NotifierStatus } from "../notify/notifier.ts";
import type { AppEnv } from "./app.ts";

/** Estado de las notificaciones: activas, desactivadas o no disponibles en esta plataforma. */
export function notificationRoutes(status: NotifierStatus = NOTIFY_NOT_CONFIGURED) {
  return new Hono<AppEnv>().get("/v1/notifications", (c) => c.json(status));
}
