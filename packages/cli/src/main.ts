import { resolveHome } from "@togi/daemon/config";
import { parseCommandLine } from "./args.ts";
import { COMMANDS, SHORTCUTS } from "./commands/index.ts";
import { CliError, renderError, usageError } from "./errors.ts";
import { createOutput } from "./output.ts";

async function main(): Promise<number> {
  const env = process.env;
  const errorOut = (noColorFlag: boolean) =>
    createOutput({ env, isTTY: process.stderr.isTTY === true, noColorFlag });
  const argv = process.argv.slice(2);
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
      }),
    );
    return 0;
  } catch (error) {
    const cli =
      error instanceof CliError
        ? error
        : (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")
          ? usageError("usage", { command: (error as Error).message })
          : null;
    if (cli === null) throw error;
    process.stderr.write(renderError(cli, errorOut(noColorFlag)));
    return cli.exitCode;
  }
}

process.exitCode = await main();
