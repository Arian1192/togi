import {
  BUILTIN_SPECIALISTS,
  type EventStore,
  isDomainError,
  type PublishedVersion,
  publishSpecialist,
  type Specialist,
  specialistStream,
  toDomainEvent,
  VersionConflictError,
} from "@togi/core";

async function published(store: EventStore, stream: string): Promise<PublishedVersion[]> {
  const versions: PublishedVersion[] = [];
  for await (const stored of store.readStream(stream)) {
    const event = toDomainEvent(stored);
    if (event.type === "specialist.version_published") {
      versions.push({ version: event.payload.specialist.version, hash: event.payload.hash });
    }
  }
  return versions;
}

/**
 * Publica los especialistas integrados que aún no están en el log; los ya publicados no duplican
 * eventos. Si uno cambió de contenido sin subir de versión, lanza y no escribe nada. No se llama al
 * arrancar (añadiría un evento al log antes que ninguna tarea): el PR 16 la llamará justo antes de
 * abrir la primera sesión que use el especialista, y esa sesión no arranca si lanza.
 */
export async function publishBuiltinSpecialists(
  store: EventStore,
  specialists: readonly Specialist[] = BUILTIN_SPECIALISTS,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  for (const specialist of specialists) {
    const stream = specialistStream(specialist.id);
    // Una carrera con otro arranque se resuelve releyendo el stream una vez.
    for (let attempt = 0; ; attempt++) {
      const history = await published(store, stream);
      const events = publishSpecialist(history, specialist, now());
      if (isDomainError(events)) throw new Error(`especialista integrado: ${events.message}`);
      if (events.length === 0) break;
      try {
        await store.append(stream, history.length, events);
        break;
      } catch (error) {
        if (!(error instanceof VersionConflictError) || attempt > 0) throw error;
      }
    }
  }
}
