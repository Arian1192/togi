export interface Rule {
  name: string;
  /** Siempre con `g`. Sin cuantificadores anidados y con cuantificadores acotados: tiempo lineal. */
  pattern: RegExp;
  /** `$1` es lo que se conserva; por defecto se sustituye todo lo detectado. */
  keep?: string;
}

const B64URL = "[A-Za-z0-9_-]";

/** Reglas tipo gitleaks. La clave privada PEM va aparte (`redact.ts`): una regex acotada la partiría. */
export const RULES: readonly Rule[] = [
  { name: "anthropic-api-key", pattern: new RegExp(`sk-ant-api\\d{2}-${B64URL}{20,}`, "g") },
  { name: "anthropic-oauth-token", pattern: new RegExp(`sk-ant-oat\\d{2}-${B64URL}{20,}`, "g") },
  {
    name: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_\w{22,255})\b/g,
  },
  { name: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA)[A-Z2-7]{16}\b/g },
  {
    name: "aws-secret-access-key",
    pattern: /aws_?secret_?access_?key["']?[ \t]{0,8}[:=][ \t]{0,8}["']?[A-Za-z0-9/+=]{40}/gi,
  },
  {
    name: "url-credentials",
    pattern: /\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s:@/'"<>]{1,128}:[^\s@/'"<>]{1,256}(?=@)/gi,
    keep: "$1",
  },
  // El token de togi son 32 bytes en base64url, sin prefijo: solo se reconoce con su contexto.
  {
    name: "togi-token",
    pattern: new RegExp(`(\\bbearer[ \\t]{1,8})${B64URL}{43}(?!${B64URL})`, "gi"),
    keep: "$1",
  },
];
