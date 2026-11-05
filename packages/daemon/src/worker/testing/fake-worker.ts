// Un trabajador de mentira para worker-launcher.test.ts. Habla el protocolo real; el modo lo elige
// argv[0] de la orden. Si la orden trae `input`, escribe ahí sus PID y el de un hijo que deja vivo.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { encodeLine, ToWorker } from "@togi/core";

const send = (m: Parameters<typeof encodeLine>[0]) => process.stdout.write(encodeLine(m));
const event = (sessionId: string, payload: unknown) =>
  send({ type: "event", sessionId, kind: "message", payload });
const done = (sessionId: string, outcome: "completed" | "cancelled") =>
  send({ type: "result", sessionId, outcome, exitCode: 0, durationMs: 1 });

let mode = "";
for await (const line of createInterface({ input: process.stdin })) {
  const order = ToWorker.parse(JSON.parse(line));
  if (order.type === "cancel") {
    if (mode !== "hang") process.exit(0);
    continue;
  }
  mode = order.argv[0] as string;
  const id = order.sessionId;
  if (order.input) {
    const child = spawn("sleep", ["60"], { stdio: "ignore" }); // sin detached: del mismo grupo
    writeFileSync(order.input, JSON.stringify({ worker: process.pid, child: child.pid }));
  }
  if (mode === "complete") {
    for (const n of [1, 2, 3]) event(id, { n });
    done(id, "completed");
  } else if (mode === "env") {
    event(id, Object.keys(process.env));
    done(id, "completed");
  } else if (mode === "stderr") {
    process.stderr.write(`${order.credential?.secret}\n`);
    for (let n = 0; n < 30; n++) process.stderr.write(`linea ${n}\n`);
    done(id, "completed");
  } else if (mode === "die") {
    event(id, { n: 1 });
    event(id, { n: 2 });
    process.stdout.write("", () => process.exit(3));
  } else {
    event(id, { n: 1 }); // hang (ignora cancel) y wait (muere al cancelar)
  }
}
