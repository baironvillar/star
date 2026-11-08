import { spawnSync } from "node:child_process";
import { StarError } from "./errors.ts";

/**
 * Lo que el kit le pregunta y le pide a git.
 *
 * Es una interfaz para que los chequeos se prueben con un doble, sin armar un
 * repositorio de verdad en cada test. Las preguntas que no se pueden contestar
 * devuelven `null` ("no sé") y quien pregunta decide; los pedidos que fallan
 * lanzan un error con lo que dijo git.
 */
export type Git = {
  /** La rama actual, o "" si HEAD está suelto. */
  branch(): string;
  /** Las líneas de `git status --porcelain`, de esos archivos o de todo el árbol. */
  dirty(paths?: string[]): string[];
  localTagExists(tag: string): boolean;
  /** `null` si no se pudo preguntar al remoto (sin red, sin `origin`). */
  remoteTagExists(tag: string): boolean | null;
  localBranchExists(name: string): boolean;
  remoteBranchExists(name: string): boolean | null;
  /** Cuántos commits tiene `ref` que HEAD no tiene, o `null` si no se sabe. */
  behind(ref: string): number | null;
  /** Cuántos commits tiene HEAD que `ref` no tiene, o `null` si no se sabe. */
  ahead(ref: string): number | null;
  /** Trae lo nuevo de `origin`. Devuelve si pudo. */
  fetch(): boolean;
  /** El asunto del commit de HEAD. */
  headSubject(): string;

  switchCreate(name: string): void;
  switchTo(name: string): void;
  pullFastForward(): void;
  add(paths: string[]): void;
  commit(message: string): void;
  push(args: string[]): void;
  tag(name: string, message: string): void;
};

export function gitIn(cwd: string): Git {
  function run(args: string[], timeout = 30_000) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout });
    return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
  }

  function must(args: string[]) {
    // Sin timeout: un commit corre los hooks de la app, y uno de esos puede ser
    // `vp check` sobre todo lo que está en el stage.
    const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
    if (r.status !== 0) {
      const detail = [r.stdout, r.stderr]
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
        .join("\n");
      throw new StarError(`git ${args[0]} falló:\n${detail}`);
    }
  }

  return {
    branch: () => run(["branch", "--show-current"]).out,
    dirty(paths) {
      const r = run(paths ? ["status", "--porcelain", "--", ...paths] : ["status", "--porcelain"]);
      return r.out ? r.out.split(/\r?\n/) : [];
    },
    localTagExists: (tag) => run(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).status === 0,
    remoteTagExists(tag) {
      // `--exit-code` sale con 2 cuando no hay coincidencias: así "no existe" se
      // distingue de "no se pudo preguntar".
      const r = run(["ls-remote", "--tags", "--exit-code", "origin", `refs/tags/${tag}`]);
      return r.status === 0 ? true : r.status === 2 ? false : null;
    },
    localBranchExists: (name) =>
      run(["rev-parse", "-q", "--verify", `refs/heads/${name}`]).status === 0,
    remoteBranchExists(name) {
      const r = run(["ls-remote", "--heads", "--exit-code", "origin", `refs/heads/${name}`]);
      return r.status === 0 ? true : r.status === 2 ? false : null;
    },
    behind(ref) {
      const r = run(["rev-list", "--count", `HEAD..${ref}`]);
      return r.status === 0 ? Number(r.out) : null;
    },
    ahead(ref) {
      const r = run(["rev-list", "--count", `${ref}..HEAD`]);
      return r.status === 0 ? Number(r.out) : null;
    },
    fetch: () => run(["fetch", "--quiet", "origin"], 60_000).status === 0,
    headSubject: () => run(["log", "-1", "--format=%s"]).out,

    switchCreate: (name) => must(["switch", "-c", name]),
    switchTo: (name) => must(["switch", name]),
    pullFastForward: () => must(["pull", "--ff-only", "--quiet"]),
    add: (paths) => must(["add", "--", ...paths]),
    commit: (message) => must(["commit", "--quiet", "-m", message]),
    push: (args) => must(["push", "--quiet", ...args]),
    tag: (name, message) => must(["tag", "-a", name, "-m", message]),
  };
}
