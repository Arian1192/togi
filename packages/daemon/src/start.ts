import { bootstrap } from "./auth/bootstrap.ts";
import { paths } from "./config/app.ts";
import { createApp } from "./http/app.ts";
import { listen } from "./http/listen.ts";

/** Arranca el daemon: primer arranque idempotente y API en el socket Unix. */
export async function startDaemon(
  home: string,
  env: Record<string, string | undefined> = process.env,
) {
  const { db, userId } = await bootstrap(home, env);
  try {
    const server = await listen(createApp(db).fetch, paths(home).socket);
    return {
      userId,
      db,
      async close() {
        await server.close();
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
