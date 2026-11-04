/** Un mensaje SSE ya completo (terminado por una línea en blanco). */
export interface SseMessage {
  id: string | undefined;
  event: string;
  data: string;
}

/** Quita el único espacio que, por la especificación, puede seguir a los dos puntos. */
const fieldValue = (value: string): string => (value.startsWith(" ") ? value.slice(1) : value);

/**
 * Lee un stream `text/event-stream` y entrega cada mensaje según se completa. Ignora los
 * comentarios (`: ping`, el latido del daemon). Un mensaje sin terminar al cerrarse el stream se
 * descarta: nunca se entrega a medias.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  let pending = "";
  let id: string | undefined;
  let event = "message";
  let data: string[] = [];

  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      // `\r\n`, `\r` y `\n` terminan línea; un `\r` final puede ser la mitad de un `\r\n`.
      const lines = pending.split(/\r\n|\r(?!$)|\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") {
          if (data.length > 0) yield { id, event, data: data.join("\n") };
          id = undefined;
          event = "message";
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const name = colon === -1 ? line : line.slice(0, colon);
        const content = colon === -1 ? "" : fieldValue(line.slice(colon + 1));
        if (name === "id") id = content;
        else if (name === "event") event = content;
        else if (name === "data") data.push(content);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
