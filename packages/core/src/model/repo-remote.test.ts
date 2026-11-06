import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGithubRemote } from "./repo-remote.ts";

test("las formas de URL de GitHub dan owner/repo, con o sin .git", () => {
  for (const url of [
    "https://github.com/Arian1192/togi",
    "https://github.com/Arian1192/togi.git",
    "https://user@github.com/Arian1192/togi.git/",
    "ssh://git@github.com/Arian1192/togi.git",
    "git@github.com:Arian1192/togi.git",
    "  git@github.com:Arian1192/togi\n",
  ]) {
    assert.equal(parseGithubRemote(url), "Arian1192/togi", url);
  }
});

test("lo que no es un remote de GitHub no da nada", () => {
  for (const url of [
    "",
    "/ruta/local/repo",
    "https://gitlab.com/o/r.git",
    "https://github.com.evil.example/o/r",
    "git@bitbucket.org:o/r.git",
    "https://github.com/solo-uno",
  ]) {
    assert.equal(parseGithubRemote(url), undefined, url);
  }
});
