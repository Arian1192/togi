import { resolveHome } from "./config/app.ts";
import { startDaemon } from "./start.ts";

/** Punto de entrada del proceso: SIGTERM o SIGINT cierran limpio; un fallo de arranque sale con 1. */
try {
  const daemon = await startDaemon(resolveHome());
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
