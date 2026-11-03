import {
  type Actor,
  ADMIN_STREAM,
  type AdminEvent,
  type DataClass,
  type NewEvent,
  type TaskId,
} from "@togi/core";
import type { DataKeyring } from "../keys/data-keys.ts";
import type { SqliteEventStore } from "../store/event-store.ts";
import type { FileBlobStore } from "./file-blob-store.ts";

interface Deps {
  events: SqliteEventStore;
  keys: DataKeyring;
  blobs: FileBlobStore;
}

/**
 * Borra los datos de una tarea y clase: destruye la clave y registra `data.erased` en una sola
 * transacción (si una falla, ninguna se aplica). Devuelve el keyId, o `null` si no había clave,
 * sin escribir evento. La limpieza de blobs va después y no es atómica; si falla, repetir `shred`.
 */
export async function erase(
  { events, keys, blobs }: Deps,
  taskId: TaskId,
  dataClass: DataClass,
  reason: string,
  actor: Actor,
): Promise<string | null> {
  const keyId = keys.find(taskId, dataClass);
  if (keyId === undefined) return null;
  const event: NewEvent = {
    type: "data.erased" satisfies AdminEvent["type"],
    schemaVersion: 1,
    actor,
    at: new Date().toISOString(),
    payload: { keyId, taskId, dataClass, reason } satisfies AdminEvent["payload"],
  };
  events.appendWithin(ADMIN_STREAM, events.currentVersion(ADMIN_STREAM), [event], () => {
    keys.destroy(keyId);
  });
  await blobs.shred(keyId);
  return keyId;
}
