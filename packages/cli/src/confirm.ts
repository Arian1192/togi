import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

const YES = /^(s|si|sí|y|yes)$/i;

/** Pregunta de sí/no. Solo `s`/`sí`/`y`/`yes` confirman; vacío, otra cosa o fin de entrada cancelan. */
export async function confirm(
  question: string,
  io: { input: Readable; output: Writable },
): Promise<boolean> {
  const rl = createInterface({ input: io.input, output: io.output, terminal: false });
  try {
    io.output.write(`${question} `);
    const answer = await new Promise<string>((resolve) => {
      rl.once("line", resolve);
      rl.once("close", () => resolve(""));
    });
    return YES.test(answer.trim());
  } finally {
    rl.close();
  }
}
