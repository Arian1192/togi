// Un trabajador de mentira cuyo agente termina con error: responde a la sesión con un resultado failed.
import { createInterface } from "node:readline";
import { encodeLine, ToWorker } from "@togi/core";

for await (const line of createInterface({ input: process.stdin })) {
  const order = ToWorker.parse(JSON.parse(line));
  if (order.type !== "session") continue;
  process.stdout.write(
    encodeLine({
      type: "result",
      sessionId: order.sessionId,
      outcome: "failed",
      exitCode: 1,
      durationMs: 1,
    }),
  );
}
