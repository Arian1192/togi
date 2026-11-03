import type { ParseArgsConfig } from "node:util";
import type { Output } from "../output.ts";
import { daemon } from "./daemon.ts";
import { task } from "./task.ts";

export type Options = NonNullable<ParseArgsConfig["options"]>;

export interface RunContext {
  home: string;
  json: boolean;
  out: Output;
  /** Valores de las opciones que declara el comando. */
  values: Record<string, string | boolean | undefined>;
  /** Argumentos posicionales tras `recurso verbo`. */
  args: string[];
}

export interface Command {
  summary: string;
  /** Ejemplo real que se enseña en la ayuda. */
  example: string;
  /** Opciones propias del comando, en el formato de `parseArgs`. */
  options?: Options;
  /** Ayuda completa de `togi <recurso> <verbo> --help`. */
  usage?: string;
  /** Devuelve el texto para stdout. Los fallos son `CliError`. */
  run(ctx: RunContext): Promise<string>;
}

/** Enrutado `recurso verbo`. */
export const COMMANDS: Record<string, Record<string, Command>> = { daemon, task };
