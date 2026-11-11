import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";

/**
 * Cómo arma GitHub el commit de un "squash and merge", leído de los ajustes del
 * repo (`gh api repos/{owner}/{repo}`).
 *
 * `squashTitle` y `squashMessage` son los valores de la API:
 * `COMMIT_OR_PR_TITLE` / `PR_TITLE` y `COMMIT_MESSAGES` / `PR_BODY` / `BLANK`.
 */
export type MergeSettings = {
  allowSquash: boolean;
  squashTitle: string;
  squashMessage: string;
};

/**
 * Lo que star le pide al repo: el squash sale del título y la descripción del
 * PR, tenga uno o veinte commits.
 *
 * Lo que GitHub trae por defecto (`COMMIT_OR_PR_TITLE` + `COMMIT_MESSAGES`)
 * usa el mensaje del commit sólo cuando el PR tiene uno. Con más, el asunto
 * pasa a ser el título del PR y el cuerpo una lista con el mensaje de cada
 * commit, y la descripción del PR no se usa. En star y Starless "funcionaba
 * solo" porque cada PR tenía un commit; en albion-calculator, el primer PR con
 * dos dejó el mensaje por escribir a mano.
 */
export const WANTED: MergeSettings = {
  allowSquash: true,
  squashTitle: "PR_TITLE",
  squashMessage: "PR_BODY",
};

/** El nombre del campo en la API de GitHub, para el PATCH. */
const API_FIELD: Record<keyof MergeSettings, string> = {
  allowSquash: "allow_squash_merge",
  squashTitle: "squash_merge_commit_title",
  squashMessage: "squash_merge_commit_message",
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

/** Lo que hay que cambiar para llegar a `WANTED`. Vacío si ya está. */
export function mergeChanges(current: MergeSettings): MergeChange[] {
  return (Object.keys(WANTED) as (keyof MergeSettings)[])
    .filter((key) => current[key] !== WANTED[key])
    .map((key) => {
      const from = current[key];
      const to = WANTED[key];
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
 * `star init github`: lee los ajustes, muestra qué cambia, pregunta y los
 * escribe. Después los vuelve a leer: un PATCH que GitHub acepta pero ignora
 * (pasa con un campo que el plan del repo no tiene) no se da por bueno.
 */
export async function configureMerge(
  gh: Pick<Gh, "mergeSettings" | "updateMergeSettings">,
  confirm: (changes: MergeChange[]) => Promise<boolean>,
): Promise<ConfigureResult> {
  const current = gh.mergeSettings();
  if (!current) return { action: "unreadable" };
  const changes = mergeChanges(current);
  if (changes.length === 0) return { action: "ready" };
  if (!(await confirm(changes))) return { action: "declined", changes };
  gh.updateMergeSettings(mergePatch(changes));
  const after = gh.mergeSettings();
  const left = after ? mergeChanges(after) : changes;
  if (left.length > 0) {
    throw new StarError(
      `GitHub no guardó: ${left.map((c) => c.description).join("; ")}. Revisa Settings → General → Pull Requests.`,
    );
  }
  return { action: "applied", changes };
}
