import { createContext } from "react";
import type { TaskRow } from "./TaskList.ts";

/**
 * Lo que la app da a la mesa para el lateral por tarea: la lista de tareas y cómo abrir el cuaderno de
 * una (fuera de la mesa). Sin proveedor, la mesa no tiene tarjetas.
 */
export interface MesaTasksValue {
  tasks: readonly TaskRow[];
  onOpen: (task: number) => void;
}

export const MesaTasksContext = createContext<MesaTasksValue>({ tasks: [], onOpen: () => {} });
