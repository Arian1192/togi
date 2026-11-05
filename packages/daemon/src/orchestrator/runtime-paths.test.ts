import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { toSrtConfig } from "../../../worker/src/sandbox/srt-config.ts";
import { SrtSandbox } from "../../../worker/src/sandbox/srt-sandbox.ts";
import { claudeRuntime } from "./runtime-paths.ts";

const REPO = realpathSync(join(import.meta.dirname, "..", "..", "..", ".."));
const WORKER = join(REPO, "packages", "worker");
const ADAPTER = join(WORKER, "src", "adapters", "claude-agent-sdk");

test("la lista es exactamente: carpeta de Node, paquete del worker, SDK con su versión y binario nativo", () => {
  const { paths, sdkVersion } = claudeRuntime(WORKER);
  assert.equal(paths.length, 4);
  assert.deepEqual(paths[0], dirname(realpathSync(process.execPath)));
  assert.equal(paths[1], realpathSync(WORKER));
  assert.match(
    paths[2] as string,
    /claude-agent-sdk@[^/]+\/node_modules\/@anthropic-ai\/claude-agent-sdk$/,
  );
  assert.ok((paths[2] as string).includes(`claude-agent-sdk@${sdkVersion}`));
  assert.match(
    paths[3] as string,
    new RegExp(`claude-agent-sdk-${process.platform}-${process.arch}@${sdkVersion}/`),
  );
});

test("la versión del SDK es la fijada en el package.json del worker", () => {
  const pkg = JSON.parse(readFileSync(join(WORKER, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(
    claudeRuntime(WORKER).sdkVersion,
    pkg.dependencies["@anthropic-ai/claude-agent-sdk"],
  );
});

test("ninguna ruta es la raíz del repo, una carpeta que la contenga, ni node_modules entero", () => {
  for (const p of claudeRuntime(WORKER).paths) {
    assert.notEqual(p, REPO);
    assert.ok(relative(p, REPO).startsWith(".."), `${p} contiene la raíz del repo`);
    assert.ok(!p.endsWith("/node_modules") && !p.endsWith("/.pnpm"), p);
  }
});

test("a allowRead de srt llega esa lista exacta, más la copia y el directorio desechable", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-rt-")));
  try {
    const home = join(root, "togi");
    const copy = join(home, "workspaces", "s1");
    const scratch = join(home, "workspaces", "s1.scratch");
    mkdirSync(copy, { recursive: true });
    mkdirSync(scratch, { recursive: true });
    const { paths } = claudeRuntime(WORKER);
    const config = toSrtConfig(
      {
        readPaths: [copy],
        writeDir: scratch,
        allowedDomains: ["api.anthropic.com"],
        allowedEnv: [],
        credentials: [],
        timeoutMs: 1000,
      },
      { home: realpathSync(process.env.HOME ?? "/"), togiHome: home, runtimePaths: paths },
    );
    assert.deepEqual(config.filesystem.allowRead, [...paths, copy, scratch]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("los módulos que carga el adaptador no importan @togi/core, que el sandbox no puede leer", () => {
  for (const file of ["main.ts", "run.ts", "planner-policy.ts"]) {
    const source = readFileSync(join(ADAPTER, file), "utf8");
    assert.ok(!/^import (?!type\b).*@togi\//m.test(source), file);
  }
});

const skip = process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS";

test("dentro de srt real, con esa lista y nada más, el adaptador y el SDK cargan", {
  skip,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-rt-srt-")));
  try {
    const home = join(root, "togi");
    mkdirSync(join(home, "workspaces", "s1"), { recursive: true });
    mkdirSync(join(home, "workspaces", "s1.scratch"), { recursive: true });
    const sandbox = new SrtSandbox({ togiHome: home, runtimePaths: claudeRuntime(WORKER).paths });
    const load = async (file: string) =>
      sandbox.run(
        {
          readPaths: [join(home, "workspaces", "s1")],
          writeDir: join(home, "workspaces", "s1.scratch"),
          allowedDomains: ["api.anthropic.com"],
          allowedEnv: ["PATH"],
          credentials: [],
          timeoutMs: 30_000,
        },
        [
          process.execPath,
          "--input-type=module",
          "-e",
          `await import(${JSON.stringify(join(ADAPTER, file))}); console.log("LOADED")`,
        ],
      );
    const result = await load("run.ts");
    assert.equal(result.stdout.trim(), "LOADED", result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
