// Un trabajador de mentira que se comporta como el real con un agente: manda mensajes y uso, y su
// resultado lleva el motivo de parada. argv = [modo, ...]. `input` es el texto final del agente.
//   plan            → message(input) + usage ok → completed
//   fail:<código>   → message(input) + usage → failed con ese failureReason (el que sea, válido o no)
//   die             → muere sin resultado
import { createInterface } from "node:readline";
import { encodeLine, ToWorker } from "@togi/core";

const send = (m: Parameters<typeof encodeLine>[0]) => process.stdout.write(encodeLine(m));

for await (const line of createInterface({ input: process.stdin })) {
  const order = ToWorker.parse(JSON.parse(line));
  if (order.type !== "session") continue;
  const id = order.sessionId;
  const [mode = "", code = ""] = (order.argv[0] ?? "").split(":");
  if (mode === "die") process.exit(3);
  send({ type: "event", sessionId: id, kind: "message", payload: { text: "pensando" } });
  send({ type: "event", sessionId: id, kind: "message", payload: { text: order.input ?? "" } });
  for (const costUsd of [0.25, 0.5]) {
    const usage = { inputTokens: 100, outputTokens: 50, costUsd, turns: 1, stop: "ok" };
    send({ type: "event", sessionId: id, kind: "usage", payload: usage });
  }
  const failed = mode === "fail";
  send({
    type: "result",
    sessionId: id,
    outcome: failed ? "failed" : "completed",
    exitCode: failed ? 1 : 0,
    durationMs: 1,
    ...(failed ? { failureReason: code } : {}),
  });
}
