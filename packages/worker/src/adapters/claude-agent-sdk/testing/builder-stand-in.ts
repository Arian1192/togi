// El agente de mentira de builder-hook.srt.test.ts: corre dentro del srt real. Recibe por la
// entrada estándar `{ run, calls }`, ejecuta `runBuilder` con un `query` falso que pasa cada
// llamada por el hook de verdad y, si el hook la deja pasar, escribe el fichero como lo haría el
// SDK. Imprime una línea JSON por cosa observada, más si pudo cargar `core` y el SDK.
import { writeFileSync } from "node:fs";
import { parseBuilderRun, runBuilder } from "../builder-run.ts";
import type { QueryFn } from "../run.ts";

type Call = { tool_name: string; tool_input: { file_path?: string; content?: string } };

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { run: input, calls } = JSON.parse(raw) as { run: unknown; calls: Call[] };
const run = parseBuilderRun(input);
if (run === null) process.exit(2);

const print = (line: unknown) => process.stdout.write(`${JSON.stringify(line)}\n`);
const loads = async (name: string) =>
  import(name).then(
    () => true,
    () => false,
  );
print({ cwd: process.cwd() });
print({ sdk: await loads("@anthropic-ai/claude-agent-sdk"), core: await loads("@togi/core") });

const query: QueryFn = ({ options }) =>
  (async function* () {
    const hook = options.hooks.PreToolUse[0].hooks[0];
    for (const call of calls) {
      const out = await hook({ hook_event_name: "PreToolUse", ...call });
      const denied = out.hookSpecificOutput?.permissionDecision === "deny";
      const file = call.tool_input.file_path;
      if (!denied && file !== undefined) writeFileSync(file, call.tool_input.content ?? "");
      print({ tool: call.tool_name, denied });
    }
    yield { type: "result", subtype: "success" };
  })();

for await (const line of runBuilder(run, query)) print({ line: line.kind });
