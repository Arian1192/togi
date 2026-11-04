import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { Readable } from "node:stream";
import { SAFE_ID } from "@togi/core";
import type { AppType } from "@togi/daemon";
import { paths } from "@togi/daemon/config";
import { hc } from "hono/client";
import { daemonUnavailable, fromProblem } from "./errors.ts";
import type { MessageParams } from "./messages.ts";

const NO_DAEMON = new Set(["ENOENT", "ECONNREFUSED"]);

/** `fetch` sobre el socket Unix del daemon, con el token y el `X-Request-Id` de esta ejecución. */
export function socketFetch(socketPath: string, token: string, requestId: string): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const { pathname, search } = new URL(req.url);
    const body = req.body === null ? undefined : Buffer.from(await req.arrayBuffer());
    const headers = { ...Object.fromEntries(req.headers), authorization: `Bearer ${token}` };
    return new Promise<Response>((resolve, reject) => {
      const call = request(
        {
          socketPath,
          path: pathname + search,
          method: req.method,
          headers: { ...headers, "x-request-id": requestId },
        },
        (res) => {
          // Se resuelve con las cabeceras y el cuerpo sigue llegando: un SSE no termina nunca.
          // Un corte a mitad de respuesta rompe la lectura del cuerpo en vez de perderse.
          const out = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (typeof value === "string") out.set(name, value);
          }
          const status = res.statusCode ?? 0;
          const noBody = status === 204 || status === 205 || status === 304;
          if (noBody) res.resume();
          resolve(
            new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
              status,
              headers: out,
            }),
          );
        },
      );
      // Abortar destruye la conexión: así `togi watch` termina con Ctrl+C aunque el stream no acabe.
      if (req.signal.aborted) call.destroy();
      else req.signal.addEventListener("abort", () => call.destroy(), { once: true });
      call.on("error", reject).end(body);
    });
  };
}

/** El id de la respuesta solo se muestra si cumple la regla del daemon; si no, el que envió la CLI. */
export function trustedRequestId(sent: string, response: Response): string {
  const received = response.headers.get("x-request-id");
  return received !== null && SAFE_ID.test(received) ? received : sent;
}

export function createClient(home: string) {
  const p = paths(home);
  const requestId = randomUUID();
  let token: string;
  try {
    token = readFileSync(p.credentials, "utf8").trim();
  } catch (error) {
    throw NO_DAEMON.has((error as NodeJS.ErrnoException).code ?? "") ? daemonUnavailable() : error;
  }
  const guarded: typeof fetch = async (input, init) => {
    try {
      return await socketFetch(p.socket, token, requestId)(input, init);
    } catch (error) {
      throw NO_DAEMON.has((error as NodeJS.ErrnoException).code ?? "")
        ? daemonUnavailable()
        : error;
    }
  };
  const api = hc<AppType>("http://togi", { fetch: guarded });

  /** Como `checked`, pero devuelve también las cabeceras (el `ETag` para `If-Match`). */
  async function checkedWithHeaders<T>(
    res: Response,
    context: MessageParams = {},
  ): Promise<{ body: T; headers: Headers }> {
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return { body: body as T, headers: res.headers };
    throw fromProblem(res.status, body, {
      ...context,
      requestId: trustedRequestId(requestId, res),
    });
  }

  /** Devuelve el JSON de una respuesta correcta; si no, lanza el `CliError` del problem+json. */
  async function checked<T>(res: Response, context: MessageParams = {}): Promise<T> {
    return (await checkedWithHeaders<T>(res, context)).body;
  }

  return { api, requestId, socket: p.socket, checked, checkedWithHeaders };
}

export type Client = ReturnType<typeof createClient>;
