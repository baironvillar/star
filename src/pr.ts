import { type Clock, waitForChecks } from "./ci-wait.ts";
import { STAR } from "./command.ts";
import { readConfig } from "./config.ts";
import { checkPullRequest, checkTitle, SUBJECT_HELP } from "./conventions.ts";
import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";
import type { Git } from "./git.ts";

/**
 * `star pr merge`: espera el CI de un PR y lo mergea a la base (decisión 24).
 *
 * Es lo mismo que hace `star release` con el PR de una versión, para cualquier
 * PR: squash con el título (y el número del PR) como asunto y la descripción
 * como cuerpo (decisión 18), sólo hacia la base. No pregunta: mergear a la base es parte
 * de lo automático; lo que se pregunta es lanzar (decisión 23). Corre en la
 * terminal de quien lo llama, así el merge dispara los workflows del push a la
 * base, cosa que un merge hecho con el `GITHUB_TOKEN` no haría.
 */

export type PrDeps = {
  root: string;
  git: Git;
  gh: Gh;
  io: { log(message: string): void; warn(message: string): void };
} & Clock;

function fail(title: string, problems: string[]): never {
  throw new StarError(`${title}\n\n${problems.map((p) => `  - ${p}`).join("\n")}`);
}

/** Mergea el PR `ref` (un número), o el de la rama actual si no se dice. */
export async function mergePr(deps: PrDeps, ref?: string): Promise<void> {
  const { root, git, gh, io } = deps;
  const config = readConfig(root);
  if (!gh.available()) throw new StarError("gh no está instalado o no tiene sesión.");

  const found = gh.viewPr(ref);
  if (!found) {
    throw new StarError(
      ref
        ? `no encontré el PR ${ref}.`
        : `la rama ${git.branch() || "actual"} no tiene PR. Ábrelo primero, o di cuál: \`${STAR} pr merge 12\`.`,
    );
  }
  const resume = `${STAR} pr merge ${found.number}`;
  if (found.state === "MERGED") {
    io.log(`El PR #${found.number} ya está mergeado.`);
    return;
  }
  if (found.state === "CLOSED") throw new StarError(`el PR #${found.number} se cerró sin mergear.`);

  // Lo que no va a cambiar mientras corre el CI se revisa antes de esperarlo.
  const problems: string[] = [];
  if (found.head.startsWith("release/")) {
    problems.push(`es el PR de una versión: se termina con \`${STAR} release finish\`.`);
  }
  const route = checkPullRequest(found.head, found.base, config.base);
  if (!route.ok) problems.push(route.reason);
  const titleCheck = checkTitle(found.title);
  if (!titleCheck.ok) {
    problems.push(
      `el título "${found.title.trim()}" no cumple la convención (${titleCheck.reason}), y va a ser el asunto del commit. Cámbialo en GitHub.\n\n${SUBJECT_HELP}`,
    );
  }
  if (problems.length > 0) fail(`El PR #${found.number} no se puede mergear:`, problems);

  const pr = await waitForChecks(deps, () => gh.viewPr(String(found.number)), resume);
  if (!pr) throw new StarError(`el PR #${found.number} desapareció mientras esperaba el CI.`);
  if (pr.state === "MERGED") {
    io.log(`El PR #${pr.number} ya está mergeado.`);
    return;
  }
  if (pr.state === "CLOSED") throw new StarError(`el PR #${pr.number} se cerró sin mergear.`);

  const after: string[] = [];
  if (pr.checks === "failing") after.push(`el CI falló: ${pr.url}`);
  if (pr.mergeable === false) after.push(`tiene conflictos con ${pr.base}.`);
  if (after.length > 0) fail(`El PR #${pr.number} no se mergeó:`, after);
  if (pr.checks === "none") io.warn(`el PR #${pr.number} no tiene checks: nada probó este cambio.`);

  // Con el número al final, como lo deja GitHub al mergear desde la web: el
  // historial de la base dice de qué PR viene cada commit.
  const title = pr.title.trim();
  const subject = title.endsWith(`(#${pr.number})`) ? title : `${title} (#${pr.number})`;
  gh.mergeSquash(pr.number, subject, pr.body);
  io.log(`✓ PR #${pr.number} mergeado a ${pr.base}: ${subject}`);

  // Si estabas en esa rama, quedas en la base al día: lo de la rama ya llegó.
  if (git.branch() === pr.head) {
    git.switchTo(pr.base);
    git.pullFastForward();
    io.log(`Quedaste en ${pr.base}, al día.`);
  }
}
