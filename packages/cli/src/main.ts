import { resolveHome } from "@togi/daemon/config";
import { parseCommandLine, usageFromParseError } from "./args.ts";
import { COMMANDS, SHORTCUTS } from "./commands/index.ts";
import { confirm } from "./confirm.ts";
import { CliError, renderError } from "./errors.ts";
import { isInteractive } from "./interactive.ts";
import { createOutput } from "./output.ts";
import { readSecret } from "./secret-input.ts";

// Una tubería que se cierra antes de tiempo (`togi watch | head`) es un final normal, no un error.
// Cualquier otro fallo de escritura se relanza.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

async function main(): Promise<number> {
  const env = process.env;
  const errorOut = (noColorFlag: boolean) =>
    createOutput({ env, isTTY: process.stderr.isTTY === true, noColorFlag });
  const argv = process.argv.slice(2);
  const abort = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"] as const) process.once(name, () => abort.abort());
  const noColorFlag = argv.includes("--no-color");
  try {
    const parsed = parseCommandLine(argv, COMMANDS, SHORTCUTS);
    if (parsed.kind === "help") {
      process.stdout.write(parsed.text);
      return 0;
    }
    const out = createOutput({ env, isTTY: process.stdout.isTTY === true, noColorFlag });
    process.stdout.write(
      await parsed.command.run({
        home: resolveHome(env),
        json: parsed.json,
        out,
        values: parsed.values,
        args: parsed.args,
        interactive: isInteractive(process.stdin, process.stderr),
        write: (text) => void process.stdout.write(text),
        signal: abort.signal,
        confirm: (question) => confirm(question, { input: process.stdin, output: process.stderr }),
        readSecret: (prompt, command) =>
          readSecret({ input: process.stdin, output: process.stderr }, prompt, command),
      }),
    );
    return 0;
  } catch (error) {
    const cli =
      error instanceof CliError
        ? error
        : (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")
          ? // El mensaje de parseArgs está en inglés y repite el flag tal cual: se traduce y, en
            // `auth`, no se nombra nada porque podría ser el secreto.
            usageFromParseError(error as Error, argv, COMMANDS, SHORTCUTS)
          : null;
    if (cli === null) throw error;
    if (cli.stdout !== undefined) process.stdout.write(cli.stdout);
    process.stderr.write(renderError(cli, errorOut(noColorFlag)));
    return cli.exitCode;
  }
}

process.exitCode = await main();
