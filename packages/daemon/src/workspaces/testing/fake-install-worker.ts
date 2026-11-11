// Un trabajador de mentira para install-runner.test.ts. Habla el protocolo real; el modo lo elige
// argv[0] de la orden de instalación.
import { createInterface } from "node:readline";
import { encodeLine, type FromWorker, WorkerInput } from "@togi/core";

const send = (m: FromWorker) => process.stdout.write(encodeLine(m));
const result = (sessionId: string, over: Partial<Extract<FromWorker, { type: "result" }>>) =>
  send({ type: "result", sessionId, outcome: "completed", exitCode: 0, durationMs: 1, ...over });

for await (const line of createInterface({ input: process.stdin })) {
  const order = WorkerInput.parse(JSON.parse(line));
  if (order.type === "cancel") continue; // como un trabajador colgado: solo lo para el grupo
  const id = order.sessionId;
  const mode = order.argv[0];
  if (mode === "ok") result(id, {});
  else if (mode === "event") {
    send({ type: "event", sessionId: id, kind: "message", payload: { text: "falso" } });
    result(id, {});
  } else if (mode === "fail") {
    for (let n = 0; n < 30; n++) process.stderr.write(`instalación: línea ${n}\n`);
    result(id, { outcome: "failed", exitCode: 2 });
  } else if (mode === "sandbox") {
    result(id, { outcome: "failed", exitCode: null, failureReason: "sandbox_unavailable" });
  } else if (mode === "timeout") result(id, { outcome: "timeout", exitCode: null });
  else if (mode === "cancelled") result(id, { outcome: "cancelled", exitCode: null });
  else if (mode === "other") result(`${id}-otra`, {});
  else if (mode === "error") send({ type: "error", code: "busy" });
  else if (mode === "die") process.exit(3);
  // "hang": no contesta nunca
}
