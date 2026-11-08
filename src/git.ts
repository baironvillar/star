import { spawnSync } from "node:child_process";

/**
 * Las preguntas que el kit le hace a git.
 *
 * Es una interfaz para que los chequeos se prueben con un doble, sin armar un
 * repositorio de verdad en cada test.
 */
export type Git = {
  /** La rama actual, o "" si HEAD está suelto. */
  branch(): string;
  /** Las líneas de `git status --porcelain` de esos archivos. */
  dirty(paths: string[]): string[];
  localTagExists(tag: string): boolean;
  /** `null` si no se pudo preguntar al remoto (sin red, sin `origin`). */
  remoteTagExists(tag: string): boolean | null;
  /** Cuántos commits tiene `ref` que HEAD no tiene, o `null` si no se sabe. */
  behind(ref: string): number | null;
};

export function gitIn(cwd: string): Git {
  // Una pregunta que no se puede contestar no es un crash: contesta "no sé",
  // y quien pregunta decide qué hacer con eso.
  function run(args: string[], timeout = 15_000) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout });
    return { status: r.status, out: (r.stdout ?? "").trim() };
  }

  return {
    branch: () => run(["branch", "--show-current"]).out,
    dirty(paths) {
      const r = run(["status", "--porcelain", "--", ...paths]);
      return r.out ? r.out.split(/\r?\n/) : [];
    },
    localTagExists: (tag) => run(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).status === 0,
    remoteTagExists(tag) {
      // `--exit-code` sale con 2 cuando no hay coincidencias: así "no existe" se
      // distingue de "no se pudo preguntar".
      const r = run(["ls-remote", "--tags", "--exit-code", "origin", `refs/tags/${tag}`]);
      if (r.status === 0) return true;
      if (r.status === 2) return false;
      return null;
    },
    behind(ref) {
      const r = run(["rev-list", "--count", `HEAD..${ref}`]);
      return r.status === 0 ? Number(r.out) : null;
    },
  };
}
