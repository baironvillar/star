import { changelogSection } from "./changelog.ts";
import type { Git } from "./git.ts";
import { hasOwnVersion } from "./manifests/types.ts";
import { disagreements, type Entry } from "./version.ts";

export type Readiness = { problems: string[]; warnings: string[] };

/**
 * Si el repositorio está listo para pasar a `next`.
 *
 * **Cada problema es una forma de que la release salga mal, y todos son más
 * baratos de atrapar acá que en la app instalada en la máquina de alguien.** Un
 * bump en la rama equivocada publica una versión que nadie aprobó; uno sobre un
 * tag que ya existe publica dos cosas con el mismo número; uno sin notas frena
 * la release en la CI cuando el tag ya se empujó, y de ahí no se vuelve sin
 * mover un tag publicado.
 */
export function checkReady(input: {
  entries: Entry[];
  current: string;
  next: string;
  changelog: string;
  git: Git;
}): Readiness {
  const { entries, current, next, changelog, git } = input;
  const problems: string[] = [];
  const warnings: string[] = [];

  const wrong = disagreements(entries, current);
  if (wrong.length > 0) {
    const list = wrong
      .map((e) => `${e.manifest.label} dice ${hasOwnVersion(e.state) ? e.state.version : "?"}`)
      .join(", ");
    problems.push(
      `los manifiestos no coinciden con ${current}: ${list}. Arréglalo con \`star version set ${current}\`.`,
    );
  }

  // Sólo los manifiestos tienen que estar limpios. El changelog se espera con
  // cambios: las notas de la versión viajan en el mismo pull request que el bump.
  const dirty = git.dirty(entries.map((e) => e.manifest.path));
  if (dirty.length > 0) {
    problems.push(
      "hay cambios sin commitear en los manifiestos. Commitéalos antes, para que el diff del bump sea sólo el número.",
    );
  }

  const branch = git.branch();
  const expected = `release/${next}`;
  if (branch !== expected) {
    problems.push(`estás en '${branch || "HEAD suelto"}' y la ${next} se sube en '${expected}'.`);
  }

  const tag = `v${next}`;
  if (git.localTagExists(tag)) {
    problems.push(`el tag ${tag} ya existe: ese número ya se publicó.`);
  } else {
    // El tag local puede faltar sólo porque no se hizo fetch. El remoto es el
    // que importa: es donde el push del tag va a chocar.
    const remote = git.remoteTagExists(tag);
    if (remote === true)
      problems.push(`el tag ${tag} ya existe en origin: ese número ya se publicó.`);
    if (remote === null) warnings.push(`no se pudo revisar si ${tag} existe en origin.`);
  }

  if (!changelogSection(changelog, next)) {
    problems.push(
      `CHANGELOG.md no tiene notas en "## [${next}]". Se escriben antes del bump: la release no sale sin ellas.`,
    );
  }

  const behind = git.behind("origin/develop");
  if (behind !== null && behind > 0) {
    warnings.push(`origin/develop tiene ${behind} commit(s) que esta rama no tiene.`);
  }

  return { problems, warnings };
}
