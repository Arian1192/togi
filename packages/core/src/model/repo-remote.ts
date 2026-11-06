// https://github.com/o/r(.git), ssh://git@github.com/o/r y git@github.com:o/r
const GITHUB_REMOTE =
  /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/(.+?)(?:\.git)?\/?$/i;

/** El `owner/repo` de la URL de un remote de GitHub; `undefined` si no lo es. Sin acceso a git ni a la red. */
export function parseGithubRemote(url: string): string | undefined {
  const m = GITHUB_REMOTE.exec(url.trim());
  return m === null ? undefined : `${m[1]}/${m[2]}`;
}
