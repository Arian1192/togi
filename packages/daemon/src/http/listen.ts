import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { dirname } from "node:path";
import { getRequestListener } from "@hono/node-server";

/** Quita un socket viejo solo si es un socket y nadie lo atiende. */
async function removeStaleSocket(path: string): Promise<void> {
  try {
    if (!lstatSync(path).isSocket()) throw new Error(`${path} existe y no es un socket`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await new Promise<void>((resolve, reject) => {
    const probe = connect(path);
    probe.once("connect", () => {
      probe.destroy();
      reject(new Error(`${path} está en uso por otro proceso`));
    });
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") {
        unlinkSync(path);
        resolve();
      } else if (error.code === "ENOENT") resolve();
      else reject(error);
    });
  });
}

/** Escucha solo en el socket Unix. `run/` es 0700 antes de escuchar: no hay ventana hasta el chmod. */
export async function listen(
  fetch: (request: Request) => Response | Promise<Response>,
  socketPath: string,
): Promise<{ close(): Promise<void> }> {
  const runDir = dirname(socketPath);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  chmodSync(runDir, 0o700);
  await removeStaleSocket(socketPath);
  const server = createServer(getRequestListener(fetch));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  chmodSync(socketPath, 0o600);
  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
