import { resolveHome } from "@togi/daemon/config";
import { parseCommandLine } from "./args.ts";
import { COMMANDS, SHORTCUTS } from "./commands/index.ts";
import { confirm } from "./confirm.ts";
import { CliError, renderError, usageError } from "./errors.ts";
import { isInteractive } from "./interactive.ts";
import { createOutput } from "./output.ts";
import { readSecret } from "./secret-input.ts";

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
          ? // El mensaje de parseArgs repite el flag tal cual: en `auth` podría ser el secreto.
            usageError("usage", {
              command: argv[0] === "auth" ? "togi auth --help" : (error as Error).message,
            })
          : null;
    if (cli === null) throw error;
    if (cli.stdout !== undefined) process.stdout.write(cli.stdout);
    process.stderr.write(renderError(cli, errorOut(noColorFlag)));
    return cli.exitCode;
  }
}

process.exitCode = await main();
