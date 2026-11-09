import { changelogSection, readChangelog } from "./changelog.ts";
import { readConfig } from "./config.ts";
import { subjectOf } from "./conventions.ts";
import { StarError } from "./errors.ts";
import type { Git } from "./git.ts";
import { currentVersion, disagreements, inspect } from "./version.ts";

export type VerifyDeps = {
  root: string;
  git: Git;
  runGate: (commands: string[]) => boolean;
  log: (message: string) => void;
};

/**
 * Todo lo que tiene que ser cierto antes de construir la release de un tag.
 *
 * Es lo que corre el workflow `verify.yml`, y se puede correr igual en local:
 * la regla está en un solo lugar. Los chequeos baratos van primero; la puerta,
 * al final.
 *
 * Devuelve la versión y sus notas.
 */
export function verifyTag(deps: VerifyDeps, tag: string): { version: string; notes: string } {
  const { root, git, log } = deps;
  const entries = inspect(root);
  const version = currentVersion(entries);

  const wrong = disagreements(entries, version);
  if (wrong.length > 0) {
    throw new StarError(
      `${wrong.map((e) => e.manifest.label).join(", ")} no dicen ${version}. Arréglalo con \`star version set ${version}\`.`,
    );
  }
  // Un tag que no coincide con los manifiestos publica un número en la release
  // y otro adentro de lo que se instala.
  if (tag !== `v${version}`) {
    throw new StarError(`el tag ${tag} no coincide con la versión v${version}.`);
  }
  log(`✓ ${tag} coincide con los manifiestos`);

  // GitHub titula la corrida de un tag con el asunto del commit etiquetado, y
  // `release finish` lo deja así. Un merge hecho a mano trae el número del PR.
  const message = git.commitMessage(tag);
  if (message === null) throw new StarError(`el tag ${tag} no está en este clon.`);
  const subject = subjectOf(message);
  if (subject !== version) {
    throw new StarError(
      `el commit de ${tag} se llama "${subject}", y tendría que llamarse "${version}". ¿Se mergeó a mano en vez de con \`star release finish\`?`,
    );
  }
  log(`✓ el commit se llama ${version}`);

  const notes = changelogSection(readChangelog(root), version);
  if (!notes) throw new StarError(`CHANGELOG.md no tiene notas en "## [${version}]".`);
  log(`✓ CHANGELOG.md tiene las notas de la ${version}`);

  const { gate } = readConfig(root);
  if (gate === null) {
    throw new StarError(
      'no hay puerta: la app no usa Vite+. Dile cuál es en package.json: "star": { "gate": [...] }.',
    );
  }
  if (!deps.runGate(gate)) throw new StarError("la puerta falló: esta versión no sale.");
  log(`✓ pasó la puerta`);

  return { version, notes };
}
