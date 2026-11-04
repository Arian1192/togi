import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { Sandbox, SandboxSpec } from "@togi/core";
import { control, ENV_NAME, KEY_NAME, probes, type Scene } from "./probes.ts";

export type Classification = "bloqueada" | "inaccesible-por-diseño";

export interface ConformanceOptions {
  /** Construye el sandbox a probar con el escenario: carpeta personal falsa, TOGI_HOME y Node. */
  create: (scene: Scene) => Sandbox;
  /** Por defecto todo es «bloqueada»; una implementación declara lo inaccesible por diseño. */
  classify?: (probeId: string) => Classification;
  /** Motivo para omitir toda la batería (otra plataforma, por ejemplo). */
  skip?: string | undefined;
}

const listen = (server: Server, where: string | { port: number; host: string }) =>
  new Promise<void>((resolve) => server.listen(where as never, resolve));

function keychain(scene: Scene): string | undefined {
  // Como el real, vive en la carpeta personal: ~/Library/Keychains.
  const path = join(scene.home, "Library", "Keychains", "conformance.keychain-db");
  mkdirSync(join(path, ".."), { recursive: true });
  try {
    execFileSync("/usr/bin/security", ["create-keychain", "-p", "x", path], { stdio: "ignore" });
    execFileSync("/usr/bin/security", ["unlock-keychain", "-p", "x", path], { stdio: "ignore" });
    const add = [
      "add-generic-password",
      "-s",
      "togi-conformance",
      "-a",
      "t",
      "-w",
      scene.fakeKey,
      path,
    ];
    execFileSync("/usr/bin/security", add, { stdio: "ignore" });
    return path;
  } catch {
    return undefined;
  }
}

/** La batería del ADR-008 (punto 8): cada sonda con su control positivo, sin imprimir contenido. */
export function runConformance(name: string, opts: ConformanceOptions): void {
  describe(`conformidad del sandbox: ${name}`, { skip: opts.skip }, () => {
    const servers: Server[] = [];
    const scene = {} as Scene;
    let keychainOk = false;
    let sockDir = "";

    before(async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "togi-conformance-")));
      const home = join(root, "home");
      const togiHome = join(home, ".togi");
      const nvm = join(home, ".nvm");
      const work = join(togiHome, "workspaces", "s1");
      Object.assign(scene, {
        root,
        home,
        togiHome,
        repo: join(work, "repo"),
        scratch: join(work, "scratch"),
        outside: join(root, "outside"),
        nodeBin: join(nvm, "versions", "node", "v24", "bin"),
        fakeKey: `falsa-${Date.now()}`,
      });
      const files = [
        join(home, "togi-conformance-secrets", "key"),
        join(home, ".ssh", "id_conformance"),
        join(home, ".aws", "credentials"),
        join(togiHome, "token"),
        join(nvm, "nvm.sh"),
        join(scene.nodeBin, "node"),
        join(nvm, "versions", "node", "v22", "bin", "node"),
      ];
      for (const dir of [scene.repo, scene.scratch, scene.outside])
        mkdirSync(dir, { recursive: true });
      for (const f of files) {
        mkdirSync(join(f, ".."), { recursive: true });
        writeFileSync(f, f.endsWith("/node") ? "#!/bin/sh\necho ALLOWED\n" : "dato-falso\n");
        if (f.endsWith("/node")) chmodSync(f, 0o755);
      }
      // Ruta corta a propósito: un socket Unix no admite más de 104 caracteres en macOS.
      sockDir = mkdtempSync("/tmp/tc-");
      scene.socket = join(sockDir, "d.sock");
      const unix = createServer((c) => c.destroy());
      const tcp = createServer((c) => c.destroy());
      servers.push(unix, tcp);
      await listen(unix, scene.socket);
      await listen(tcp, { port: 0, host: "127.0.0.1" });
      scene.port = (tcp.address() as { port: number }).port;
      if (process.platform === "darwin") scene.keychain = keychain(scene);
      keychainOk = scene.keychain !== undefined;
      process.env[ENV_NAME] = "valor-falso";
      process.env[KEY_NAME] = scene.fakeKey;
    });

    after(async () => {
      for (const s of servers) await new Promise((r) => s.close(r));
      delete process.env[ENV_NAME];
      delete process.env[KEY_NAME];
      if (scene.keychain) {
        try {
          execFileSync("/usr/bin/security", ["delete-keychain", scene.keychain], {
            stdio: "ignore",
          });
        } catch {} // ya borrado
      }
      rmSync(scene.root, { recursive: true, force: true });
      rmSync(sockDir, { recursive: true, force: true });
    });

    for (const probe of probes) {
      const kind =
        probe.expect === "DENIED" ? (opts.classify?.(probe.id) ?? "bloqueada") : "permitida";
      const needsKeychain = probe.id === "llavero";
      const skip =
        needsKeychain && process.platform !== "darwin" ? "el Llavero solo existe en macOS" : false;
      test(`${kind}: ${probe.title} [${probe.id}]`, { todo: probe.todo }, async (t) => {
        if (skip || (needsKeychain && !keychainOk)) return t.skip(skip || "Llavero no disponible");
        const argv = probe.argv(scene);
        const finish = async (stdout: string) =>
          probe.outcome ? probe.outcome(scene, stdout) : stdout;
        if (probe.expect === "DENIED" || probe.control) {
          const positive = await finish(await control(argv));
          if (positive !== "ALLOWED" && probe.controlFailure)
            return t.skip(`${probe.controlFailure} (control: ${positive})`);
          assert.equal(
            positive,
            "ALLOWED",
            "el control positivo sin sandbox falla: la sonda no prueba nada",
          );
        }
        const spec: SandboxSpec = {
          readPaths: [scene.repo],
          writeDir: scene.scratch,
          allowedDomains: [],
          allowedEnv: ["PATH"],
          credentials: [],
          timeoutMs: 20000,
          ...probe.spec?.(scene),
        };
        const result = await opts.create(scene).run(spec, argv);
        assert.equal(result.timedOut, false, "la sonda agotó el tope de tiempo");
        assert.equal(await finish(result.stdout.trim()), probe.expect);
      });
    }
  });
}
