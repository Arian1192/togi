/** Los cinco tokens semánticos de la guía de estilo (docs/cli-estilo.md). */
export type Token = "ok" | "attention" | "error" | "muted" | "accent";

export interface OutputOptions {
  env: Record<string, string | undefined>;
  isTTY: boolean;
  noColorFlag: boolean;
}

const ANSI: Record<Token, number> = { ok: 32, attention: 33, error: 31, muted: 90, accent: 36 };
const UNICODE: Record<Token, string> = {
  ok: "✓",
  attention: "●",
  error: "✗",
  muted: "·",
  accent: "",
};
const ASCII: Record<Token, string> = {
  ok: "ok",
  attention: "*",
  error: "x",
  muted: "-",
  accent: "",
};

/** Prioridad: `--no-color` > `NO_COLOR` > `FORCE_COLOR` > ¿es una terminal? */
function wantsColor({ env, isTTY, noColorFlag }: OutputOptions): boolean {
  if (noColorFlag) return false;
  if ((env.NO_COLOR ?? "") !== "") return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== "") return force !== "0" && force !== "false";
  return isTTY;
}

function wantsUnicode(env: Record<string, string | undefined>): boolean {
  if (env.TERM === "dumb") return false;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return /utf-?8/i.test(locale);
}

export function createOutput(options: OutputOptions) {
  const color = wantsColor(options);
  const symbols = wantsUnicode(options.env) ? UNICODE : ASCII;
  const paint = (token: Token, text: string): string =>
    color ? `\x1b[${ANSI[token]}m${text}\x1b[0m` : text;
  const symbol = (token: Token): string => symbols[token];
  /** Símbolo y texto, pintados juntos; `accent` no lleva símbolo. */
  const mark = (token: Token, text: string): string =>
    paint(token, symbol(token) === "" ? text : `${symbol(token)} ${text}`);
  return { color, paint, symbol, mark };
}

export type Output = ReturnType<typeof createOutput>;
