import { resolveHome } from "./config/app.ts";
import { createNotifier } from "./notify/notifier.ts";
import { productionPlanner } from "./production-planner.ts";
import { startDaemon } from "./start.ts";

/** Punto de entrada del proceso: SIGTERM o SIGINT cierran limpio; un fallo de arranque sale con 1. */
try {
  const { source, status } = productionPlanner(process.platform, process.env);
  // Que un planificador desactivado no pase desapercibido: queda en el log y en `togi daemon status`.
  if (status.state !== "active") {
    process.stderr.write(`togi-daemon: planificador ${status.state}: ${status.reason}\n`);
  }
  const daemon = await startDaemon(resolveHome(), process.env, {
    ...(source === undefined ? {} : { planner: source }),
    plannerStatus: status,
    notify: createNotifier().notify,
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    daemon.close().then(
      () => process.exit(0),
      (error: unknown) => {
        process.stderr.write(`togi-daemon: error al cerrar: ${String(error)}\n`);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (error) {
  process.stderr.write(`togi-daemon: no se pudo arrancar: ${(error as Error).message}\n`);
  process.exit(1);
}
