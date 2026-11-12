import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";

/**
 * Los ajustes del repo en GitHub que le importan a star, leídos de
 * `gh api repos/{owner}/{repo}`.
 *
 * `squashTitle` y `squashMessage` son los valores de la API:
 * `COMMIT_OR_PR_TITLE` / `PR_TITLE` y `COMMIT_MESSAGES` / `PR_BODY` / `BLANK`.
 */
export type MergeSettings = {
  allowSquash: boolean;
  squashTitle: string;
  squashMessage: string;
  allowMergeCommit: boolean;
  allowRebase: boolean;
  defaultBranch: string;
};

/**
 * Lo que star le pide al repo.
 *
 * **El squash sale del título y la descripción del PR** (decisión 18), tenga
 * uno o veinte commits. Lo de GitHub por defecto usa el mensaje del commit sólo
 * cuando el PR tiene uno; con más, el cuerpo es la lista de commits.
 *
 * **Sólo squash** (decisión 19). `main` la actualiza `star release finish`, así
 * que ningún PR necesita merge commit ni rebase. Con los tres habilitados,
 * GitHub ofrecía primero el merge commit, con "Merge pull request #N from…"
 * como asunto: pasó en el primer PR de sme.
 *
 * **La rama por defecto es la base**: es el destino de todo PR, y GitHub lee de
 * ahí la plantilla de PR.
 */
export function wanted(base: string): MergeSettings {
  return {
    allowSquash: true,
    squashTitle: "PR_TITLE",
    squashMessage: "PR_BODY",
    allowMergeCommit: false,
    allowRebase: false,
    defaultBranch: base,
  };
}

/** El nombre del campo en la API de GitHub, para el PATCH. */
const API_FIELD: Record<keyof MergeSettings, string> = {
  allowSquash: "allow_squash_merge",
  squashTitle: "squash_merge_commit_title",
  squashMessage: "squash_merge_commit_message",
  allowMergeCommit: "allow_merge_commit",
  allowRebase: "allow_rebase_merge",
  defaultBranch: "default_branch",
};

/** Cómo se llama cada valor en la página de ajustes de GitHub. */
const LABEL: Record<string, string> = {
  true: "habilitado",
  false: "deshabilitado",
  COMMIT_OR_PR_TITLE: "el commit si hay uno solo, si no el título del PR",
  PR_TITLE: "el título del PR",
  COMMIT_MESSAGES: "la lista de mensajes de los commits",
  PR_BODY: "la descripción del PR",
  BLANK: "vacío",
};

const WHAT: Record<keyof MergeSettings, string> = {
  allowSquash: "squash and merge",
  squashTitle: "asunto del squash",
  squashMessage: "cuerpo del squash",
  allowMergeCommit: "merge commit",
  allowRebase: "rebase and merge",
  defaultBranch: "rama por defecto",
};

export type MergeChange = {
  key: keyof MergeSettings;
  /** El campo de la API: `squash_merge_commit_title`. */
  field: string;
  from: string | boolean;
  to: string | boolean;
  /** Para una persona: `asunto del squash: el commit si hay uno solo… → el título del PR`. */
  description: string;
};

/** Lo que hay que cambiar para llegar a `wanted(base)`. Vacío si ya está. */
export function mergeChanges(current: MergeSettings, base: string): MergeChange[] {
  const target = wanted(base);
  return (Object.keys(target) as (keyof MergeSettings)[])
    .filter((key) => current[key] !== target[key])
    .map((key) => {
      const from = current[key];
      const to = target[key];
      const label = (v: string | boolean) => LABEL[String(v)] ?? String(v);
      return {
        key,
        field: API_FIELD[key],
        from,
        to,
        description: `${WHAT[key]}: ${label(from)} → ${label(to)}`,
      };
    });
}

/** Los campos del PATCH, con su tipo: los booleanos van como booleanos. */
export function mergePatch(changes: MergeChange[]): Record<string, string | boolean> {
  return Object.fromEntries(changes.map((c) => [c.field, c.to]));
}

export type ConfigureResult =
  | { action: "unreadable" }
  | { action: "ready" }
  | { action: "declined"; changes: MergeChange[] }
  | { action: "applied"; changes: MergeChange[] };

/**
 * Lee los ajustes, muestra qué cambia, pregunta y los escribe. Después los
 * vuelve a leer: un PATCH que GitHub acepta pero ignora (pasa con un campo que
 * el plan del repo no tiene) no se da por bueno.
 */
export async function configureMerge(
  gh: Pick<Gh, "mergeSettings" | "updateMergeSettings">,
  base: string,
  confirm: (changes: MergeChange[]) => Promise<boolean>,
): Promise<ConfigureResult> {
  const current = gh.mergeSettings();
  if (!current) return { action: "unreadable" };
  const changes = mergeChanges(current, base);
  if (changes.length === 0) return { action: "ready" };
  if (!(await confirm(changes))) return { action: "declined", changes };
  gh.updateMergeSettings(mergePatch(changes));
  const after = gh.mergeSettings();
  const left = after ? mergeChanges(after, base) : changes;
  if (left.length > 0) {
    throw new StarError(
      `GitHub no guardó: ${left.map((c) => c.description).join("; ")}. Revisa Settings → General.`,
    );
  }
  return { action: "applied", changes };
}
