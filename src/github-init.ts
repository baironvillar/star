import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";
import type { Git } from "./git.ts";
import { configureMerge, mergeChanges, type MergeChange } from "./merge-settings.ts";
import { MAIN } from "./release.ts";

/**
 * `star init github`: todo lo que el repo en GitHub necesita para que el primer
 * PR ya cumpla la convención (decisión 20).
 *
 * Antes eran piezas sueltas (`init github` sólo ajustaba el squash, el workflow
 * del título y la plantilla de PR se escribían a mano) y en sme el primer PR
 * salió sin ellas. Ver `docs/diagnostico-arranque-sme.md`.
 */

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "github");

/** Los archivos que escribe, con su plantilla y su lugar en la app. */
export const GITHUB_FILES = [
  { template: "pr-title.yml", path: ".github/workflows/pr-title.yml" },
  { template: "PULL_REQUEST_TEMPLATE.md", path: ".github/PULL_REQUEST_TEMPLATE.md" },
] as const;

export const INITIAL_COMMIT = "chore: start the repository";

export type GithubFile = { path: string; content: string };

/**
 * Cómo quedan `main` y la base en origin.
 *
 * - `ready`: están las dos.
 * - `empty`: no está ninguna y la rama local no tiene commits: un repo nuevo.
 * - `missing`: falta una, y se crea desde la otra.
 */
export type Bootstrap =
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "missing"; branch: string; from: string };

export type GithubPlan = {
  bootstrap: Bootstrap;
  /** Los archivos que faltan en la app y se van a escribir. */
  files: GithubFile[];
  /** Los ajustes del repo que cambian. */
  changes: MergeChange[];
};

function template(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, name), "utf8");
}

/** Si algún workflow de la app ya revisa el título con star. */
function titleLinted(root: string): boolean {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return false;
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .some((f) => /\bstar\s+lint\s+title\b/.test(readFileSync(join(dir, f), "utf8")));
}

/**
 * Los archivos que faltan. Uno que existe es de la app y no se toca, aunque su
 * contenido sea otro (decisión 14). El workflow del título tampoco se escribe
 * si otro workflow ya corre `star lint title`.
 */
export function missingFiles(root: string): GithubFile[] {
  return GITHUB_FILES.filter(({ path }) => !existsSync(join(root, path)))
    .filter(({ template }) => template !== "pr-title.yml" || !titleLinted(root))
    .map(({ template: name, path }) => ({ path, content: template(name) }));
}

export function planBootstrap(git: Git, base: string): Bootstrap {
  const hasMain = git.remoteBranchExists(MAIN);
  const hasBase = git.remoteBranchExists(base);
  if (hasMain === null || hasBase === null) {
    throw new StarError(
      "no se pudo preguntar a origin qué ramas tiene. ¿Hay red y un remoto origin?",
    );
  }
  if (hasMain && hasBase) return { kind: "ready" };
  if (hasMain) return { kind: "missing", branch: base, from: MAIN };
  if (hasBase) return { kind: "missing", branch: MAIN, from: base };
  // Ni main ni la base, pero la rama local ya tiene historia: es una app que
  // existe y se está subiendo a un repo nuevo. Inventarle un commit inicial la
  // dejaría sin historia en común con esa rama.
  if (git.hasCommits()) {
    throw new StarError(
      `origin no tiene ${MAIN} ni ${base}, y tu rama ya tiene commits. Empújala como ${base} (\`git push -u origin HEAD:${base}\`) y vuelve a correr esto.`,
    );
  }
  return { kind: "empty" };
}

export function planGithub(root: string, git: Git, gh: Gh, base: string): GithubPlan {
  const bootstrap = planBootstrap(git, base);
  const settings = gh.mergeSettings();
  if (!settings) {
    throw new StarError(
      "no se pudieron leer los ajustes del repo. Hace falta un origin en GitHub y permiso de admin.",
    );
  }
  return { bootstrap, files: missingFiles(root), changes: mergeChanges(settings, base) };
}

/** Lo que se le muestra a la persona antes de preguntar. Vacío si no hay nada que hacer. */
export function describePlan(plan: GithubPlan, base: string): string[] {
  const lines: string[] = [];
  const { bootstrap } = plan;
  if (bootstrap.kind === "empty") {
    lines.push(
      `El repo está vacío: un commit inicial ("${INITIAL_COMMIT}") con los archivos de abajo, y ${MAIN} y ${base} desde él, empujadas a origin.`,
    );
  }
  if (bootstrap.kind === "missing") {
    lines.push(`origin no tiene ${bootstrap.branch}: se crea desde ${bootstrap.from} y se empuja.`);
  }
  for (const file of plan.files) lines.push(`escribir ${file.path}`);
  for (const change of plan.changes) lines.push(change.description);
  return lines;
}

export type ApplyResult = {
  /** Los archivos quedaron escritos pero sin commitear (repo con historia). */
  uncommitted: string[];
  /** Quedó parado en `main` o en la base, con lo que tenía en el stage. */
  onProtected: string | null;
};

/**
 * Hace lo planeado, en orden: las ramas primero (la rama por defecto no se
 * puede apuntar a una que no existe), los archivos, y los ajustes al final,
 * que se vuelven a leer para confirmar que GitHub los guardó.
 */
export async function applyGithub(
  plan: GithubPlan,
  root: string,
  git: Git,
  gh: Gh,
  base: string,
): Promise<ApplyResult> {
  const { bootstrap } = plan;
  let uncommitted: string[] = plan.files.map((f) => f.path);
  let onProtected: string | null = null;

  for (const file of plan.files) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }

  if (bootstrap.kind === "empty") {
    // El commit inicial lleva los archivos de star tal como quedan en el disco,
    // incluso si la app ya tenía alguno con otro contenido.
    const files = GITHUB_FILES.map(({ path }) => ({
      path,
      content: readFileSync(join(root, path), "utf8"),
    }));
    const sha = git.commitFiles(files, INITIAL_COMMIT);
    git.setBranch(MAIN, sha);
    git.setBranch(base, sha);
    // La rama donde se está trabajando, todavía sin commits, se apunta al mismo
    // commit: si no, su primer commit sería otra raíz, sin historia en común
    // con la base, y GitHub no la deja abrir un PR.
    const current = git.branch();
    if (current && current !== MAIN && current !== base) git.setBranch(current, sha);
    if (current === MAIN || current === base) onProtected = current;
    // El stage queda igual que el commit para esos archivos: sin esto, git los
    // ve borrados del stage.
    git.add(files.map((f) => f.path));
    // Es el único push a main y a la base que hace star fuera de una versión, y
    // lo hace él en vez de pedirle a la persona que se salte su propio hook.
    git.push(["--no-verify", "origin", MAIN, base]);
    uncommitted = [];
  }

  if (bootstrap.kind === "missing") {
    const start =
      bootstrap.branch === MAIN
        ? git.rootCommit(`origin/${bootstrap.from}`)
        : git.commitOf(`origin/${bootstrap.from}`);
    if (!start) throw new StarError(`no encontré origin/${bootstrap.from} en el clon.`);
    git.push(["--no-verify", "origin", `${start}:refs/heads/${bootstrap.branch}`]);
  }

  // Ya se preguntó por todo el plan: acá sólo se escribe y se verifica.
  const result = await configureMerge(gh, base, async () => true);
  if (result.action === "unreadable") {
    throw new StarError("no se pudieron volver a leer los ajustes del repo después de cambiarlos.");
  }
  return { uncommitted, onProtected };
}
