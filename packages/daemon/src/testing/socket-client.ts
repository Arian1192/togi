import { readFileSync } from "node:fs";
import { request } from "node:http";
import { paths } from "../config/app.ts";

export interface SocketResponse {
  status: number;
  etag?: string;
  json: Record<string, unknown>;
}

/** Cliente de tests: peticiones por el socket Unix del daemon con el token de `credentials`. */
export function socketClient(home: string) {
  return function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<SocketResponse> {
    const token = readFileSync(paths(home).credentials, "utf8").trim();
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: paths(home).socket,
          method,
          path,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            ...headers,
          },
        },
        (res) => {
          let text = "";
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              ...(res.headers.etag === undefined ? {} : { etag: res.headers.etag }),
              json: JSON.parse(text),
            }),
          );
        },
      );
      req.on("error", reject).end(body === undefined ? undefined : JSON.stringify(body));
    });
  };
}
