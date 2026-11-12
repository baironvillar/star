import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  /** El sha del commit al que apunta `rev` (pela un tag anotado), o `null` si no está. */
  commitOf(rev: string): string | null;
  /** El mensaje entero de un commit, o `null` si ese commit no está en el clon. */
  commitMessage(rev: string): string | null;
  /**
   * Los commits de `base..head` sin los merges, del más nuevo al más viejo.
   * Con `exclude`, sin ese commit ni sus ancestros.
   */
  commitsBetween(base: string, head: string, exclude?: string): string[];
  /** El valor de una clave de `git config`, o `null` si no está. */
  getConfig(key: string): string | null;
  setConfig(key: string, value: string): void;
  /** Pone los archivos en el stage como ejecutables, aunque el disco no lo diga (Windows). */
  addExecutable(paths: string[]): void;
  /** El modo de cada archivo en el índice (`100644`, `100755`); los que no están, faltan. */
  indexModes(paths: string[]): Record<string, string>;
  /** Los archivos commiteados cuyo contenido calza con la expresión (ERE de git grep). */
  trackedMatching(pattern: string): string[];
  /** Si la rama actual ya tiene algún commit (en un repo recién creado, no). */
  hasCommits(): boolean;
  /** Si `ancestor` está en la historia de `descendant`; `null` si alguno no existe. */
  isAncestor(ancestor: string, descendant: string): boolean | null;
  /** El primer commit de la historia de `ref`, o `null` si no está. */
  rootCommit(ref: string): string | null;
  /**
   * Un commit sin padres con exactamente esos archivos, armado en un índice
   * aparte: no toca el stage ni el árbol de quien lo corre. Devuelve el sha.
   */
  commitFiles(files: { path: string; content: string }[], message: string): string;
  /** Apunta la rama a ese commit (`update-ref`), exista o no. */
  setBranch(name: string, sha: string): void;
  /** Merge con commit propio y ese asunto. Si choca, lo aborta y lanza. */
  mergeNoFf(ref: string, message: string): void;

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
    // Sólo se recorta el final. `git status --porcelain` empieza con un espacio
    // cuando el cambio no está en el stage (" M CHANGELOG.md"), y recortar el
    // principio corría la primera línea un carácter: el archivo se leía como
    // "HANGELOG.md" y un changelog con notas se tomaba por un cambio prohibido.
    return { status: r.status, out: (r.stdout ?? "").trimEnd(), err: (r.stderr ?? "").trim() };
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
    commitOf(rev) {
      const r = run(["rev-parse", "--verify", "-q", `${rev}^{commit}`]);
      return r.status === 0 ? r.out : null;
    },
    commitMessage(rev) {
      // `-e` antes: `git log` de un sha que no existe falla con un error largo, y
      // "ese commit no está" es una respuesta, no un error.
      if (run(["cat-file", "-e", `${rev}^{commit}`]).status !== 0) return null;
      // El mensaje lo saca git y no un pipe del shell: en un runner de Windows el
      // pipe de PowerShell recodifica el texto.
      return run(["log", "-1", "--format=%B", rev]).out;
    },
    commitsBetween(base, head, exclude) {
      const r = run([
        "rev-list",
        "--no-merges",
        `${base}..${head}`,
        ...(exclude ? ["--not", exclude] : []),
      ]);
      if (r.status !== 0) throw new StarError(`git no pudo listar ${base}..${head}:\n${r.err}`);
      return r.out ? r.out.split(/\r?\n/) : [];
    },
    getConfig(key) {
      const r = run(["config", "--get", key]);
      return r.status === 0 ? r.out : null;
    },
    setConfig: (key, value) => must(["config", key, value]),
    addExecutable: (paths) => must(["add", "--chmod=+x", "--", ...paths]),
    indexModes(paths) {
      const modes: Record<string, string> = {};
      const r = run(["ls-files", "-s", "--", ...paths]);
      for (const line of r.out ? r.out.split(/\r?\n/) : []) {
        const [meta, path] = line.split("\t");
        const mode = meta?.split(" ")[0];
        if (path && mode) modes[path] = mode;
      }
      return modes;
    },
    hasCommits: () => run(["rev-parse", "-q", "--verify", "HEAD"]).status === 0,
    isAncestor(ancestor, descendant) {
      const r = run(["merge-base", "--is-ancestor", ancestor, descendant]);
      return r.status === 0 ? true : r.status === 1 ? false : null;
    },
    rootCommit(ref) {
      const r = run(["rev-list", "--max-parents=0", ref]);
      return r.status === 0 && r.out ? (r.out.split(/\r?\n/).at(-1) ?? null) : null;
    },
    commitFiles(files, message) {
      // Un índice propio en vez del de la app: en un repo recién creado, quien
      // corre esto puede tener su trabajo en el stage, y ese trabajo no va en
      // el commit inicial.
      const index = join(tmpdir(), `star-index-${process.pid}-${Date.now()}`);
      const env = { ...process.env, GIT_INDEX_FILE: index };
      const step = (args: string[], input?: string) => {
        const r = spawnSync("git", args, { cwd, encoding: "utf8", env, input });
        if (r.status !== 0) {
          throw new StarError(`git ${args[0]} falló:\n${(r.stderr ?? "").trim()}`);
        }
        return (r.stdout ?? "").trim();
      };
      try {
        for (const file of files) {
          const blob = step(["hash-object", "-w", "--stdin"], file.content);
          step(["update-index", "--add", "--cacheinfo", `100644,${blob},${file.path}`]);
        }
        const tree = step(["write-tree"]);
        return step(["commit-tree", tree, "-m", message]);
      } finally {
        rmSync(index, { force: true });
      }
    },
    setBranch: (name, sha) => must(["update-ref", `refs/heads/${name}`, sha]),
    mergeNoFf(ref, message) {
      const r = spawnSync("git", ["merge", "--no-ff", "--no-edit", "-m", message, ref], {
        cwd,
        encoding: "utf8",
      });
      if (r.status !== 0) {
        // Un merge a medias deja la rama en un estado que nadie pidió.
        spawnSync("git", ["merge", "--abort"], { cwd });
        throw new StarError(`git no pudo mergear ${ref}:\n${(r.stdout ?? "").trim()}`);
      }
    },
    trackedMatching(pattern) {
      // `-I` salta los binarios. git grep sale con 1 cuando no encuentra nada.
      const r = run(["grep", "-l", "-I", "-E", "-e", pattern]);
      return r.status === 0 && r.out ? r.out.split(/\r?\n/) : [];
    },

    switchCreate: (name) => must(["switch", "-c", name]),
    switchTo: (name) => must(["switch", name]),
    pullFastForward: () => must(["pull", "--ff-only", "--quiet"]),
    add: (paths) => must(["add", "--", ...paths]),
    commit: (message) => must(["commit", "--quiet", "-m", message]),
    push: (args) => must(["push", "--quiet", ...args]),
    tag: (name, message) => must(["tag", "-a", name, "-m", message]),
  };
}
