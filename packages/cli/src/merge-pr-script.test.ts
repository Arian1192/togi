import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = join(import.meta.dirname, "..", "..", "..", "tools", "merge-pr.sh");
const BRANCH = "feat/x";
const GREEN = JSON.stringify(
  ["check (22.18.0)", "check (24.22.1)", "sandbox-macos", "rust"].map((name) => ({
    name,
    state: "SUCCESS",
  })),
);
const RED = GREEN.replace('"rust","state":"SUCCESS"', '"rust","state":"FAILURE"');

const REQUIRED_JOBS = ["check (22.18.0)", "check (24.22.1)", "sandbox-macos", "rust"];
const PENDING = GREEN.replace('"rust","state":"SUCCESS"', '"rust","state":"PENDING"');

// gh falso: responde a view/checks/api, registra cada llamada y simula el merge empujando el head a main.
// El head vive en $FAKE_STATE/head; update-branch lo cambia a $FAKE_STATE/newhead si existe.
// Las primeras $FAKE_PENDING_CALLS consultas de checks devuelven $FAKE_PENDING.
// Con --delete-branch borra la rama remota y falla al borrar la local, sugiriendo «git worktree remove».
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "pr view")
    case "$*" in
      *headRefOid*) cat "$FAKE_STATE/head" ;;
      *headRefName*) echo "$FAKE_BRANCH" ;;
      *) echo "\${FAKE_PR_STATE:-OPEN}" ;;
    esac ;;
  "pr checks")
    n=$(( $(cat "$FAKE_STATE/n" 2>/dev/null || echo 0) + 1 )); echo $n > "$FAKE_STATE/n"
    if (( n <= \${FAKE_PENDING_CALLS:-0} )); then echo "$FAKE_PENDING"; else echo "$FAKE_CHECKS"; fi ;;
  "pr update-branch") if [[ -f "$FAKE_STATE/newhead" ]]; then cp "$FAKE_STATE/newhead" "$FAKE_STATE/head"; fi ;;
  "pr merge")
    if [[ "$*" == *--auto* ]]; then exit 0; fi
    git push -q origin "$(cat "$FAKE_STATE/head"):refs/heads/main"
    if [[ "$*" == *--delete-branch* ]]; then
      git push -q origin --delete "$FAKE_BRANCH"
      if ! git branch -D "$FAKE_BRANCH" 2>/dev/null; then
        echo "failed to delete local branch $FAKE_BRANCH. To remove the worktree: git worktree remove ../wt" >&2
        exit 1
      fi
    fi ;;
esac
if [[ "$1" == api ]]; then
  if [[ -n "$FAKE_PROTECTION_FAIL" ]]; then echo "HTTP 404" >&2; exit 1; fi
  printf '%s\\n' "$FAKE_PROTECTION"
fi
`;

function setup() {
  const root = mkdtempSync(join(tmpdir(), "togi-merge-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  const repo = join(root, "clon");
  const wt = join(root, "wt");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  git(root, "init", "-q", "--bare", "-b", "main", "origen.git");
  git(root, "clone", "-q", "origen.git", "clon");
  writeFileSync(join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "switch", "-q", "-c", BRANCH);
  writeFileSync(join(repo, "b.txt"), "b");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "cambio");
  git(repo, "push", "-q", "-u", "origin", BRANCH);
  git(repo, "switch", "-q", "main");
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "gh"), FAKE_GH);
  chmodSync(join(root, "bin", "gh"), 0o755);
  const log = join(root, "gh.log");
  writeFileSync(log, "");
  const head = git(repo, "rev-parse", BRANCH);
  writeFileSync(join(root, "head"), head);
  const runWith = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync("bash", [SCRIPT, ...args], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        MERGE_PR_POLL_SECONDS: "0",
        MERGE_PR_MAX_POLLS: "3",
        FAKE_GH_LOG: log,
        FAKE_STATE: root,
        FAKE_BRANCH: BRANCH,
        FAKE_CHECKS: GREEN,
        FAKE_PENDING: PENDING,
        FAKE_PROTECTION: REQUIRED_JOBS.join("\n"),
        ...extra,
      },
    });
  const run = (checks = GREEN) => runWith(["7"], { FAKE_CHECKS: checks });
  const calls = () => readFileSync(log, "utf8");
  // main avanza un commit; update-branch del gh falso dejará el PR rebasado sobre él.
  const goBehind = () => {
    writeFileSync(join(repo, "n.txt"), "n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "nuevo en main");
    git(repo, "push", "-q", "origin", "main");
    git(repo, "switch", "-q", "-c", "rebased", BRANCH);
    git(repo, "rebase", "-q", "main");
    git(repo, "push", "-q", "origin", "rebased");
    writeFileSync(join(root, "newhead"), git(repo, "rev-parse", "HEAD"));
    git(repo, "switch", "-q", "main");
  };
  return { root, repo, wt, git, run, runWith, calls, head, goBehind };
}

function inWorktree<T>(fn: (s: ReturnType<typeof setup>) => T): T {
  const s = setup();
  try {
    s.git(s.repo, "worktree", "add", "-q", s.wt, BRANCH);
    return fn(s);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
}

test("rama abierta en un worktree: queda desacoplado en origin/main y la rama local se borra", () => {
  inWorktree((s) => {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(s.git(s.wt, "branch", "--show-current"), "");
    assert.equal(s.git(s.wt, "rev-parse", "HEAD"), s.git(s.repo, "rev-parse", "origin/main"));
    assert.equal(s.git(s.repo, "branch", "--list", BRANCH), "");
    assert.equal(s.git(s.repo, "ls-remote", "--heads", "origin", BRANCH), "");
  });
});

test("rama abierta en un worktree: la carpeta sigue y nunca se habla de «git worktree remove»", () => {
  inWorktree((s) => {
    const r = s.run();
    assert.ok(existsSync(join(s.wt, "b.txt")));
    assert.doesNotMatch(r.stdout + r.stderr, /worktree remove/);
    assert.doesNotMatch(s.calls(), /--delete-branch/);
  });
});

test("rama abierta en un worktree con commits locales sin subir: se conserva la rama", () => {
  inWorktree((s) => {
    writeFileSync(join(s.wt, "c.txt"), "c");
    s.git(s.wt, "add", ".");
    s.git(s.wt, "commit", "-q", "-m", "local");
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(s.git(s.wt, "branch", "--show-current"), "");
    assert.notEqual(s.git(s.repo, "branch", "--list", BRANCH), "");
  });
});

test("rama sin worktree: gh pr merge --rebase --delete-branch como siempre", () => {
  const s = setup();
  try {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(s.calls(), /pr merge 7 --rebase --delete-branch/);
    assert.doesNotMatch(r.stdout + r.stderr, /worktree/);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("worktree con cambios sin commitear: aborta sin mergear y sin tocar nada", () => {
  inWorktree((s) => {
    writeFileSync(join(s.wt, "b.txt"), "sucio");
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /cambios sin commitear/);
    assert.doesNotMatch(r.stdout + r.stderr, /worktree remove/);
    assert.doesNotMatch(s.calls(), /pr merge/);
    assert.equal(readFileSync(join(s.wt, "b.txt"), "utf8"), "sucio");
    assert.equal(s.git(s.wt, "branch", "--show-current"), BRANCH);
  });
});

test("un job obligatorio sin verde: sale con 1 sin mergear", () => {
  const s = setup();
  try {
    const r = s.run(RED);
    assert.equal(r.status, 1);
    assert.doesNotMatch(s.calls(), /pr merge/);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

test("PR por detrás de main: sale con 1 sin mergear", () => {
  const s = setup();
  try {
    writeFileSync(join(s.repo, "n.txt"), "n");
    s.git(s.repo, "add", ".");
    s.git(s.repo, "commit", "-q", "-m", "nuevo en main");
    s.git(s.repo, "push", "-q", "origin", "main");
    const r = s.run();
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no está al día/);
    assert.doesNotMatch(s.calls(), /pr merge/);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
});

function withRepo<T>(fn: (s: ReturnType<typeof setup>) => T): T {
  const s = setup();
  try {
    return fn(s);
  } finally {
    rmSync(s.root, { recursive: true, force: true });
  }
}

const checkCalls = (calls: string) => calls.split("\n").filter((l) => l.startsWith("pr checks"));

test("PR por detrás de main: update-branch, espera a la CI del nuevo head y mergea", () => {
  inWorktree((s) => {
    s.goBehind();
    const r = s.runWith(["7"], { FAKE_PENDING_CALLS: "2" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = s.calls();
    assert.ok(c.indexOf("pr update-branch 7 --rebase") < c.indexOf("pr checks"));
    assert.ok(checkCalls(c).length >= 3);
    assert.ok(c.lastIndexOf("pr checks") < c.indexOf("pr merge 7 --rebase"));
    assert.equal(
      s.git(s.repo, "ls-remote", "origin", "refs/heads/main").split("\t")[0],
      readFileSync(join(s.root, "newhead"), "utf8"),
    );
    assert.equal(s.git(s.repo, "branch", "--list", BRANCH), "");
  });
});

test("PR por detrás de main cuya CI falla tras actualizar: sale con 1 sin mergear", () => {
  withRepo((s) => {
    s.goBehind();
    const r = s.runWith(["7"], { FAKE_CHECKS: RED });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /«rust».*FAILURE/);
    assert.match(s.calls(), /pr update-branch 7 --rebase/);
    assert.doesNotMatch(s.calls(), /pr merge/);
  });
});

test("PR actualizado cuya CI no termina antes de agotar la espera: sale con 1 sin mergear", () => {
  withRepo((s) => {
    s.goBehind();
    const r = s.runWith(["7"], { FAKE_PENDING_CALLS: "99" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /«rust».*PENDING/);
    assert.doesNotMatch(s.calls(), /pr merge/);
  });
});

test("PR al día con un job pendiente y sin --auto: no espera, sale con 1", () => {
  withRepo((s) => {
    const r = s.run(PENDING);
    assert.equal(r.status, 1);
    assert.equal(checkCalls(s.calls()).length, 1);
    assert.doesNotMatch(s.calls(), /pr merge/);
  });
});

test("--auto con el PR al día: activa gh pr merge --auto --rebase sin mergear ni tocar el worktree", () => {
  inWorktree((s) => {
    const r = s.runWith(["--auto", "7"], { FAKE_CHECKS: PENDING });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(s.calls(), /pr merge 7 --auto --rebase/);
    assert.doesNotMatch(s.calls(), /--delete-branch|update-branch|pr merge 7 --rebase\n/);
    assert.equal(s.git(s.wt, "branch", "--show-current"), BRANCH);
    assert.equal(s.git(s.repo, "ls-remote", "origin", BRANCH).split("\t")[0], s.head);
  });
});

test("--auto con un job obligatorio ya en FAILURE: sale con 1 sin activarlo", () => {
  withRepo((s) => {
    const r = s.runWith(["--auto", "7"], { FAKE_CHECKS: RED });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /«rust».*FAILURE/);
    assert.doesNotMatch(s.calls(), /pr merge/);
  });
});

test("--auto con el PR por detrás de main: update-branch y luego merge automático", () => {
  withRepo((s) => {
    s.goBehind();
    const r = s.runWith(["7", "--auto"], { FAKE_CHECKS: PENDING });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = s.calls();
    assert.ok(c.indexOf("pr update-branch 7 --rebase") < c.indexOf("pr merge 7 --auto --rebase"));
  });
});

test("--auto con la protección de main sin un job de REQUIRED: se niega y dice cuál falta", () => {
  withRepo((s) => {
    s.goBehind();
    const r = s.runWith(["--auto", "7"], { FAKE_PROTECTION: REQUIRED_JOBS.slice(0, 3).join("\n") });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Faltan en la protección de main:\n {4}- rust\n/);
    assert.doesNotMatch(r.stdout, /Faltan en REQUIRED/);
    assert.doesNotMatch(s.calls(), /update-branch|pr merge/);
  });
});

test("--auto con la protección de main con un job que REQUIRED no tiene: se niega y dice cuál", () => {
  withRepo((s) => {
    const r = s.runWith(["--auto", "7"], {
      FAKE_PROTECTION: [...REQUIRED_JOBS, "lint"].join("\n"),
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Faltan en REQUIRED \(tools\/merge-pr\.sh\):\n {4}- lint\n/);
    assert.doesNotMatch(r.stdout, /Faltan en la protección/);
    assert.doesNotMatch(s.calls(), /pr merge/);
  });
});

test("--auto sin protección legible o sin jobs en ella: se niega", () => {
  withRepo((s) => {
    const unreadable = s.runWith(["--auto", "7"], { FAKE_PROTECTION_FAIL: "1" });
    assert.equal(unreadable.status, 1);
    assert.match(unreadable.stdout, /No puedo leer la protección/);
    const empty = s.runWith(["--auto", "7"], { FAKE_PROTECTION: "" });
    assert.equal(empty.status, 1);
    assert.match(empty.stdout, /Faltan en la protección de main:(\n {4}- .*){4}/);
    assert.doesNotMatch(s.calls(), /pr merge/);
  });
});

test("PR cerrado: sale con 1 sin mirar nada más", () => {
  withRepo((s) => {
    const r = s.runWith(["7"], { FAKE_PR_STATE: "MERGED" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no está abierto \(MERGED\)/);
    assert.doesNotMatch(s.calls(), /pr checks|pr merge/);
  });
});

test("sin número de PR: sale con error sin llamar a gh", () => {
  withRepo((s) => {
    const r = s.runWith(["--auto"]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Uso: tools\/merge-pr\.sh/);
    assert.equal(s.calls(), "");
  });
});
