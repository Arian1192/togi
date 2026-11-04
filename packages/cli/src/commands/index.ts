import type { ParseArgsConfig } from "node:util";
import type { Output } from "../output.ts";
import { admin } from "./admin.ts";
import { daemon } from "./daemon.ts";
import { plan } from "./plan.ts";
import { status } from "./status.ts";
import { task } from "./task.ts";
import { watch } from "./watch.ts";

export type Options = NonNullable<ParseArgsConfig["options"]>;

export interface RunContext {
  home: string;
  json: boolean;
  out: Output;
  /** Valores de las opciones que declara el comando. */
  values: Record<string, string | boolean | undefined>;
  /** Argumentos posicionales tras `recurso verbo`. */
  args: string[];
  /** ¿Hay una terminal interactiva (stdin y stderr)? Solo entonces se puede preguntar. */
  interactive: boolean;
  /** Escribe en stdout según llega, para los comandos que no terminan (`togi watch`). */
  write(text: string): void;
  /** Se aborta con Ctrl+C (SIGINT) o SIGTERM. */
  signal: AbortSignal;
  /** Hace una pregunta de sí/no por stderr. */
  confirm(question: string): Promise<boolean>;
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
export const COMMANDS: Record<string, Record<string, Command>> = { admin, daemon, plan, task };

/** Atajos de un verbo (`togi status`), sin recurso. */
export const SHORTCUTS: Record<string, Command> = { status, watch };
