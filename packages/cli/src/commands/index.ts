import type { Output } from "../output.ts";
import { daemon } from "./daemon.ts";

export interface Command {
  summary: string;
  /** Ejemplo real que se enseña en la ayuda. */
  example: string;
  /** Devuelve el texto para stdout. Los fallos son `CliError`. */
  run(ctx: { home: string; json: boolean; out: Output }): Promise<string>;
}

/** Enrutado `recurso verbo`. */
export const COMMANDS: Record<string, Record<string, Command>> = { daemon };
