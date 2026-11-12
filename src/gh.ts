import { spawnSync } from "node:child_process";
import { StarError } from "./errors.ts";
import type { MergeSettings } from "./merge-settings.ts";

export type PullRequest = {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  /** El resumen de los checks del último commit. */
  checks: "passing" | "failing" | "pending" | "none";
  /** `false` si tiene conflictos; `null` si GitHub todavía no lo calcula. */
  mergeable: boolean | null;
};

/** Un PR con lo que hace falta para mergearlo: título, descripción y ramas. */
export type PullRequestDetail = PullRequest & {
  title: string;
  body: string;
  base: string;
  head: string;
};

/** Lo que el kit le pide a GitHub, a través de `gh`. Interfaz para probarlo con un doble. */
export type Gh = {
  /** Si `gh` está instalado y con sesión. */
  available(): boolean;
  /** Abre el PR y devuelve su URL. */
  createPr(input: { base: string; head: string; title: string; body: string }): string;
  /** El PR más reciente de esa rama, abierto o no. */
  findPr(head: string): PullRequest | null;
  /** Un PR por número, o el de la rama actual si no se dice. `null` si no hay. */
  viewPr(ref?: string): PullRequestDetail | null;
  /** Squash and merge con el asunto exacto, y el cuerpo que se diga (vacío si no). */
  mergeSquash(number: number, subject: string, body?: string): void;
  /** Los assets de la release de ese tag, también si es un borrador. */
  releaseAssets(tag: string): { id: number; name: string }[];
  /** El contenido de un asset como texto, o `null` si no está. */
  downloadAsset(tag: string, name: string): string | null;
  /** Los nombres de los secretos del repo (nunca los valores), o `null` si no se pudo preguntar. */
  secretNames(): string[] | null;
  /** Guarda un secreto del repo. El valor va por stdin: nunca en argv ni en pantalla. */
  setSecret(name: string, value: string): void;
  /** Los ajustes de merge y la rama por defecto del repo, o `null` si no se pudo preguntar. */
  mergeSettings(): MergeSettings | null;
  /** Cambia ajustes del repo (`gh api -X PATCH`). Hace falta ser admin. */
  updateMergeSettings(fields: Record<string, string | boolean>): void;
};

type RepoJson = {
  allow_squash_merge?: boolean;
  squash_merge_commit_title?: string;
  squash_merge_commit_message?: string;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  default_branch?: string;
};

/**
 * Los ajustes de merge que vienen en `GET /repos/{owner}/{repo}`. Sin permiso
 * de escritura GitHub omite los campos del squash: eso es "no se sabe", no un
 * valor.
 */
export function parseMergeSettings(json: string): MergeSettings | null {
  const repo = JSON.parse(json || "{}") as RepoJson;
  if (
    typeof repo.allow_squash_merge !== "boolean" ||
    typeof repo.squash_merge_commit_title !== "string" ||
    typeof repo.squash_merge_commit_message !== "string" ||
    typeof repo.allow_merge_commit !== "boolean" ||
    typeof repo.allow_rebase_merge !== "boolean"
  ) {
    return null;
  }
  return {
    allowSquash: repo.allow_squash_merge,
    squashTitle: repo.squash_merge_commit_title,
    squashMessage: repo.squash_merge_commit_message,
    allowMergeCommit: repo.allow_merge_commit,
    allowRebase: repo.allow_rebase_merge,
    // Un repo vacío no tiene rama por defecto todavía.
    defaultBranch: repo.default_branch ?? "",
  };
}

type Rollup = { status?: string; conclusion?: string; state?: string };

/**
 * Los checks de un PR, reducidos a una palabra.
 *
 * `statusCheckRollup` mezcla dos tipos: los check runs de Actions (con `status`
 * y `conclusion`) y los commit statuses de otros servicios (con `state`). Un
 * neutral o un skipped no frena nada; un cancelado sí, porque no prueba nada.
 */
export function summarizeChecks(rollup: Rollup[]): PullRequest["checks"] {
  if (rollup.length === 0) return "none";
  let pending = false;
  for (const item of rollup) {
    const result = (item.conclusion || item.state || "").toUpperCase();
    const status = (item.status ?? "").toUpperCase();
    if (
      ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(
        result,
      )
    ) {
      return "failing";
    }
    if (
      result === "PENDING" ||
      result === "EXPECTED" ||
      (status !== "" && status !== "COMPLETED")
    ) {
      pending = true;
    }
  }
  return pending ? "pending" : "passing";
}

export function ghIn(cwd: string): Gh {
  function run(args: string[], input?: string) {
    const r = spawnSync("gh", args, { cwd, encoding: "utf8", input, timeout: 60_000 });
    return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
  }

  return {
    available: () => run(["auth", "status"]).status === 0,
    createPr({ base, head, title, body }) {
      // El cuerpo va por stdin: son las notas del changelog, y en la línea de
      // comandos de Windows las comillas y los saltos de línea no sobreviven.
      const r = run(
        ["pr", "create", "--base", base, "--head", head, "--title", title, "--body-file", "-"],
        body,
      );
      if (r.status !== 0) throw new StarError(`gh no pudo abrir el PR:\n${r.err}`);
      return r.out.split(/\r?\n/).pop() ?? "";
    },
    findPr(head) {
      const r = run([
        "pr",
        "list",
        "--head",
        head,
        "--state",
        "all",
        "--limit",
        "1",
        "--json",
        "number,url,state,mergeable,statusCheckRollup",
      ]);
      if (r.status !== 0) throw new StarError(`gh no pudo buscar el PR de ${head}:\n${r.err}`);
      const [pr] = JSON.parse(r.out || "[]") as {
        number: number;
        url: string;
        state: PullRequest["state"];
        mergeable: string;
        statusCheckRollup: Rollup[] | null;
      }[];
      if (!pr) return null;
      return {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        checks: summarizeChecks(pr.statusCheckRollup ?? []),
        mergeable:
          pr.mergeable === "MERGEABLE" ? true : pr.mergeable === "CONFLICTING" ? false : null,
      };
    },
    viewPr(ref) {
      const r = run([
        "pr",
        "view",
        ...(ref ? [ref] : []),
        "--json",
        "number,url,state,mergeable,statusCheckRollup,title,body,baseRefName,headRefName",
      ]);
      // gh sale con error cuando la rama no tiene PR: eso es "no hay", no una falla.
      if (r.status !== 0) {
        if (/no pull requests found|could not resolve/i.test(r.err)) return null;
        throw new StarError(`gh no pudo leer el PR:
${r.err}`);
      }
      const pr = JSON.parse(r.out) as {
        number: number;
        url: string;
        state: PullRequest["state"];
        mergeable: string;
        statusCheckRollup: Rollup[] | null;
        title: string;
        body: string;
        baseRefName: string;
        headRefName: string;
      };
      return {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        checks: summarizeChecks(pr.statusCheckRollup ?? []),
        mergeable:
          pr.mergeable === "MERGEABLE" ? true : pr.mergeable === "CONFLICTING" ? false : null,
        title: pr.title,
        body: pr.body ?? "",
        base: pr.baseRefName,
        head: pr.headRefName,
      };
    },
    mergeSquash(number, subject, body = "") {
      // El cuerpo por stdin, como al crear el PR: en Windows los saltos de
      // línea no sobreviven en argv.
      const r = run(
        ["pr", "merge", String(number), "--squash", "--subject", subject, "--body-file", "-"],
        body,
      );
      if (r.status !== 0) throw new StarError(`gh no pudo mergear el PR #${number}:\n${r.err}`);
    },
    releaseAssets(tag) {
      // `gh release view` encuentra los borradores; la API por tag no.
      const r = run(["release", "view", tag, "--json", "assets"]);
      if (r.status !== 0) throw new StarError(`gh no encontró la release ${tag}:\n${r.err}`);
      const { assets } = JSON.parse(r.out) as { assets: { apiUrl: string; name: string }[] };
      return assets.map((a) => ({
        id: Number(/\/assets\/(\d+)/.exec(a.apiUrl)?.[1] ?? Number.NaN),
        name: a.name,
      }));
    },
    secretNames() {
      const r = run(["secret", "list", "--json", "name"]);
      if (r.status !== 0) return null;
      return (JSON.parse(r.out || "[]") as { name: string }[]).map((s) => s.name);
    },
    setSecret(name, value) {
      // Sin `--body`: gh lee el valor de stdin. En argv lo vería cualquier
      // proceso de la máquina, y quedaría en el historial de la terminal.
      const r = run(["secret", "set", name], value);
      // El error de gh no trae el valor; igual no se muestra stdout.
      if (r.status !== 0) throw new StarError(`gh no pudo guardar el secreto ${name}:\n${r.err}`);
    },
    mergeSettings() {
      // `{owner}/{repo}` lo resuelve gh con el remoto del clon.
      const r = run(["api", "repos/{owner}/{repo}"]);
      if (r.status !== 0) return null;
      return parseMergeSettings(r.out);
    },
    updateMergeSettings(fields) {
      // `-F` convierte true/false en booleanos; `-f` deja el texto tal cual.
      const args = Object.entries(fields).flatMap(([key, value]) =>
        typeof value === "boolean" ? ["-F", `${key}=${value}`] : ["-f", `${key}=${value}`],
      );
      const r = run(["api", "-X", "PATCH", "repos/{owner}/{repo}", ...args]);
      if (r.status !== 0) {
        throw new StarError(
          `gh no pudo cambiar los ajustes del repo (hace falta ser admin):\n${r.err}`,
        );
      }
    },
    downloadAsset(tag, name) {
      // `-p` es un glob: los corchetes de un nombre se escapan para que calce
      // sólo ese archivo.
      const pattern = name.replace(/[[\]*?]/g, (c) => `[${c}]`);
      const r = run(["release", "download", tag, "-p", pattern, "-O", "-"]);
      return r.status === 0 ? r.out : null;
    },
  };
}
