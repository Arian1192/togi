import assert from "node:assert/strict";
import { test } from "node:test";
import { DISCARDED, MAX_REDACT_CHARS, redact } from "./redact.ts";

// Los secretos de prueba se arman por partes: así ningún escáner los toma por reales.
const pad = (c: string, n: number) => c.repeat(n);
const ANTHROPIC = ["sk-ant-", "api03-", pad("aB3_", 12)].join("");
const OAUTH = ["sk-ant-", "oat01-", pad("xY9-", 12)].join("");
const GITHUB = ["gh", "p_", pad("a1B2", 9)].join("");
const GITHUB_PAT = ["github", "_pat_", pad("A1b2", 7), "_", pad("z", 20)].join("");
const AWS = ["AK", "IA", "IOSFODNN7EXAMPLE"].join("");
const AWS_SECRET = [
  "aws_secret",
  "_access_key = ",
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
].join("");
const TOGI = pad("tT0_", 11).slice(0, 43);
const body = pad("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n", 6);
const PEM = (kind: string) =>
  [`-----BEGIN ${kind}PRIVATE KEY-----`, body, `-----END ${kind}PRIVATE KEY-----`].join("\n");

const CASES: [string, string, string][] = [
  ["anthropic-api-key", ANTHROPIC, "clave de API de Anthropic"],
  ["anthropic-oauth-token", OAUTH, "token de suscripción"],
  ["github-token", GITHUB, "token de GitHub"],
  ["github-token", GITHUB_PAT, "token de GitHub de granularidad fina"],
  ["aws-access-key-id", AWS, "clave de acceso de AWS"],
  ["private-key", PEM(""), "clave privada PKCS#8"],
  ["private-key", PEM("RSA "), "clave privada RSA"],
  ["private-key", PEM("OPENSSH "), "clave privada de OpenSSH"],
];

for (const [rule, secret, label] of CASES) {
  test(`limpia ${label}`, () => {
    const out = redact(`antes ${secret} después`);
    assert.equal(out, `antes [REDACTED:${rule}] después`);
  });
}

test("limpia la clave secreta de AWS con su contexto", () => {
  assert.equal(redact(`export ${AWS_SECRET}\nok`), "export [REDACTED:aws-secret-access-key]\nok");
});

test("limpia usuario y contraseña de una URL y conserva el resto", () => {
  assert.equal(
    redact("clone https://deploy:s3cr3t-pass@git.example.com/org/repo.git"),
    "clone https://[REDACTED:url-credentials]@git.example.com/org/repo.git",
  );
  assert.equal(
    redact("postgres://app:pw@db:5432/x"),
    "postgres://[REDACTED:url-credentials]@db:5432/x",
  );
});

test("limpia el token de togi con su contexto y por valor exacto", () => {
  assert.equal(
    redact(`Authorization: Bearer ${TOGI}`),
    "Authorization: Bearer [REDACTED:togi-token]",
  );
  assert.equal(redact(`token=${TOGI} fin`, [TOGI]), "token=[REDACTED:togi-token] fin");
});

test("una clave privada sin final se oculta hasta el fin del texto", () => {
  const out = redact(`ok\n-----BEGIN OPENSSH PRIVATE KEY-----\n${body}`);
  assert.equal(out, "ok\n[REDACTED:private-key]");
});

test("varios secretos en un mismo texto", () => {
  const out = redact(`${ANTHROPIC} y ${PEM("EC ")} y ${AWS}`);
  assert.equal(
    out,
    "[REDACTED:anthropic-api-key] y [REDACTED:private-key] y [REDACTED:aws-access-key-id]",
  );
});

test("textos parecidos que no son secretos pasan intactos", () => {
  for (const text of [
    "la clave empieza por sk-ant- y sigue",
    "sk-ant-api03-corta",
    "AKIA corto y AKIAIOSFODNN7EXAMPL",
    "550e8400-e29b-41d4-a716-446655440000",
    "commit 3f786850e387550fdab836ed7e6dc881de23001b",
    "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0B\n-----END PUBLIC KEY-----",
    "-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIE\n-----END CERTIFICATE-----",
    "https://example.com/ruta?x=1",
    "http://localhost:8080/api",
    "escribe a usuario@host.com",
    "git@github.com:org/repo.git",
    "ghp_ suelto y ghp_corto",
    "Bearer corto",
    "aws_secret_access_key sin valor",
    `hash ${pad("0123456789abcdef", 4)}`,
    "texto normal con ñ, tildes y emojis 🙂",
    "",
  ]) {
    assert.equal(redact(text), text, text);
  }
});

test("la limpieza es idempotente", () => {
  const once = redact(`${ANTHROPIC} ${PEM("")}`);
  assert.equal(redact(once), once);
});

// Un texto patológico por regla: debe terminar en poco tiempo y limpiar lo que toque.
const N = 150_000;
const PATHOLOGICAL: [string, string][] = [
  ["anthropic-api-key", pad("sk-ant-api03-aaaaaaaaaaaaaaaaaaa ", N / 30)],
  ["anthropic-oauth-token", pad("sk-ant-oat01-", N / 10)],
  ["github-token", pad(`gh${"p"}_${pad("a", 35)} `, N / 40)],
  ["aws-access-key-id", pad("AKIAAAAAAAAAAAAAAA ", N / 20)],
  ["aws-secret-access-key", `aws_secret_access_key${pad(" ", N)}`],
  ["url-credentials", `a://${pad("u", N)}`],
  ["url-credentials (muchos inicios)", pad("a://u:", N / 6)],
  ["togi-token", pad("Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ", N / 50)],
  ["private-key (sin final)", pad("-----BEGIN PRIVATE KEY-----\n", N / 28)],
  ["private-key (cabecera larga)", `-----BEGIN ${pad("A", N)}`],
];

for (const [name, text] of PATHOLOGICAL) {
  test(`texto patológico para ${name}: termina en poco tiempo`, () => {
    const start = performance.now();
    const out = redact(text, [pad("x", 64)]);
    const ms = performance.now() - start;
    assert.ok(ms < 1000, `${name}: ${ms.toFixed(0)} ms`);
    assert.notEqual(out, DISCARDED);
  });
}

test("un texto por encima del tamaño máximo se descarta, nunca se devuelve sin limpiar", () => {
  const big = `${ANTHROPIC} ${pad("a", MAX_REDACT_CHARS)}`;
  const out = redact(big);
  assert.equal(out, DISCARDED);
  assert.ok(!out.includes("sk-ant"));
  assert.notEqual(redact(pad("a", MAX_REDACT_CHARS)), DISCARDED);
});
