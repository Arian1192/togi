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

// gh falso: responde a view/checks, registra cada llamada y simula el merge empujando el head a main.
// Con --delete-branch borra la rama remota y falla al borrar la local, sugiriendo «git worktree remove».
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_LOG"
case "$1 $2" in
  "pr view")
    case "$*" in
      *headRefOid*) echo "$FAKE_HEAD" ;;
      *headRefName*) echo "$FAKE_BRANCH" ;;
      *) echo OPEN ;;
    esac ;;
  "pr checks") echo "$FAKE_CHECKS" ;;
  "pr merge")
    git push -q origin "$FAKE_HEAD:refs/heads/main"
    if [[ "$*" == *--delete-branch* ]]; then
      git push -q origin --delete "$FAKE_BRANCH"
      if ! git branch -D "$FAKE_BRANCH" 2>/dev/null; then
        echo "failed to delete local branch $FAKE_BRANCH. To remove the worktree: git worktree remove ../wt" >&2
        exit 1
      fi
    fi ;;
esac
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
  const run = (checks = GREEN) =>
    spawnSync("bash", [SCRIPT, "7"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        FAKE_GH_LOG: log,
        FAKE_HEAD: head,
        FAKE_BRANCH: BRANCH,
        FAKE_CHECKS: checks,
      },
    });
  const calls = () => readFileSync(log, "utf8");
  return { root, repo, wt, git, run, calls, head };
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
