import { test } from "node:test";
import { hc } from "hono/client";
import type { AppType } from "./app.ts";

// La comprobación es de compilación (`pnpm typecheck`): hc<AppType> conoce cada ruta y rechaza las demás.
test("hc<AppType> tipa todas las rutas y rechaza las inexistentes", () => {
  const client = hc<AppType>("http://localhost");
  void (() => {
    void client.v1.health.$get();
    void client.v1.tasks.$get({ query: { state: "draft", limit: "10" } });
    void client.v1.tasks.$post();
    void client.v1.tasks[":n"].$patch({ param: { n: "1" } });
    void client.v1.tasks[":n"].submit.$post({ param: { n: "1" } });
    void client.v1.tasks[":n"].reject.$post({ param: { n: "1" } });
    void client.v1.tasks[":n"].events.$get({ param: { n: "1" } });
    void client.v1.events.$get();
    // @ts-expect-error la ruta no existe
    void client.v1.nada.$get();
    // @ts-expect-error el método no existe en esa ruta
    void client.v1.tasks[":n"].$delete({ param: { n: "1" } });
  });
});
