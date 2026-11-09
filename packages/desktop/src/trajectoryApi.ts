import { invoke } from "@tauri-apps/api/core";
import type { TrajectoryResult } from "./Trajectory.ts";

// El comando de Tauri de la trayectoria. El `invoke` lleva su nombre escrito: así
// frontend-boundary.test.ts lo ve y la lista de comandos permitidos sigue cerrada. El webview solo
// pasa el número de tarea, el cursor y la marca de su sesión; qué sesión se lee lo elige Rust.

/** Una página de la trayectoria a partir de `after`; un fallo al invocar es un motivo cerrado. */
export function readTrajectory(
  number: number,
  after: number,
  mark: string | null,
): Promise<TrajectoryResult> {
  return invoke<TrajectoryResult>("read_trajectory", { number, after, mark }).catch(
    (): TrajectoryResult => ({ status: "unreachable", reason: "app" }),
  );
}
