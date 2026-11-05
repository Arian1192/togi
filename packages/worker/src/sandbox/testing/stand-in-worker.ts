// Un trabajador de mentira para credential-env.test.ts: ejecuta con srt real un agente que busca la
// credencial en el entorno de los procesos que puede leer, e imprime ALLOWED, DENIED o ERROR.
// La credencial llega por la entrada estándar, como al trabajador de verdad. Con
// TOGI_STANDIN_ENV=initial, el test la pone además en el entorno inicial de este proceso.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SrtSandbox } from "../srt-sandbox.ts";
import { scanArgv } from "./probes.ts";

const KEY = "TOGI_STANDIN_KEY";
let real = "";
for await (const chunk of process.stdin) real += chunk;
real = real.trim();

const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-standin-")));
const work = join(root, "togi", "workspaces", "s1");
mkdirSync(join(work, "repo"), { recursive: true });
mkdirSync(join(work, "scratch"), { recursive: true });
try {
  process.env[KEY] = real; // como el trabajador: en tiempo de ejecución, no en el entorno inicial
  const sandbox = new SrtSandbox({ togiHome: join(root, "togi"), runtimePaths: [] });
  const result = await sandbox.run(
    {
      readPaths: [join(work, "repo")],
      writeDir: join(work, "scratch"),
      allowedDomains: ["api.anthropic.com"],
      allowedEnv: ["PATH", KEY],
      credentials: [{ name: KEY, injectDomains: ["api.anthropic.com"] }],
      timeoutMs: 30_000,
    },
    scanArgv(`${KEY}=${real}`),
  );
  process.stdout.write(result.stdout.trim());
} finally {
  delete process.env[KEY];
  rmSync(root, { recursive: true, force: true });
}
