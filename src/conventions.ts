/**
 * Las convenciones de commits y ramas, escritas una sola vez.
 *
 * Las usan los hooks de git de la app (`star hook …`) y su CI (`star lint …`):
 * el mismo código en los dos lados, para que lo que pasa en local no falle en el
 * PR. Antes vivían en scripts `sh` copiados en cada repo (flotas, Starless), y
 * las copias ya habían empezado a diferir.
 */

export const TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "style",
  "revert",
] as const;

export const MAX_SUBJECT = 72;
export const MAX_BRANCH = 60;

const SCOPE = "[a-z0-9._/-]+";
const VERSION = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?";
const CONVENTIONAL = new RegExp(`^(?:${TYPES.join("|")})(?:\\(${SCOPE}\\))?: (.)`);

/**
 * Los mensajes que escribe el propio git (revert, autosquash, merges de GitHub)
 * se dejan pasar: para frenarlos habría que usar --no-verify, que es justo el
 * hábito que después desactiva todo lo demás.
 */
const WRITTEN_BY_GIT =
  /^(?:Revert "|fixup! |squash! |amend! |Merge pull request |Merge branch |Merge remote-tracking branch )/;

export type Verdict = { ok: true } | { ok: false; reason: string };

const ok: Verdict = { ok: true };
const fail = (reason: string): Verdict => ({ ok: false, reason });

/** La primera línea, sin el BOM que escribe PowerShell ni el CR de Windows. */
export function subjectOf(message: string): string {
  return (message.replace(/^﻿/, "").split("\n")[0] ?? "").replace(/\r$/, "").trimEnd();
}

/**
 * El asunto de un commit: `tipo(scope): asunto` o la versión sola (`0.4.0`).
 *
 * Nunca se reescribe el mensaje: un hook que edita lo que escribiste es un hook
 * del que no te fías después.
 */
export function checkSubject(subject: string): Verdict {
  if (subject === "") return fail("el asunto está vacío");
  if (WRITTEN_BY_GIT.test(subject)) return ok;
  if (new RegExp(`^${VERSION}$`).test(subject)) return ok;

  // La longitud se mide sobre lo que escribió una persona: el " (#42)" que
  // GitHub agrega al squash no cuenta.
  const written = subject.replace(/ (?:\(#[0-9]+\)|#[0-9]+)$/, "");
  const length = written.length;
  if (length > MAX_SUBJECT)
    return fail(`tiene ${length} caracteres, y el máximo es ${MAX_SUBJECT}`);
  if (subject.endsWith(".")) return fail("termina en punto");

  const match = CONVENTIONAL.exec(subject);
  if (!match) return fail("no empieza con `tipo(scope): ` o le falta el espacio después de `:`");
  const first = match[1] ?? "";
  if (first === " ") return fail("hay más de un espacio después de `:`");
  // Sólo las mayúsculas ASCII: un asunto en inglés no empieza con una tilde, y
  // lo que no es una letra (un número, un `@`) puede ir primero.
  if (/[A-Z]/.test(first)) return fail("empieza con mayúscula");
  return ok;
}

export function checkMessage(message: string): Verdict {
  return checkSubject(subjectOf(message));
}

/**
 * El título de un pull request. Con los ajustes de merge que pide star
 * (`star init github`), GitHub lo usa como asunto del squash, así que sigue la
 * misma regla que un commit: es el asunto del commit que llega a la base.
 */
export function checkTitle(title: string): Verdict {
  return checkSubject(title.trim());
}

/**
 * El nombre de una rama: `tipo/descripcion-corta` o `release/<versión>`.
 *
 * `hotfix` vale como tipo de rama aunque no de commit: es la rama que sale de
 * `main` para arreglar una versión publicada.
 */
export function checkBranch(name: string): Verdict {
  const length = name.length;
  if (length > MAX_BRANCH) return fail(`tiene ${length} caracteres, y el máximo es ${MAX_BRANCH}`);
  const pattern = new RegExp(
    `^(?:(?:${[...TYPES, "hotfix"].join("|")})/[a-z0-9]+(?:-[a-z0-9]+)*|release/${VERSION})$`,
  );
  if (!pattern.test(name)) return fail("no es `tipo/descripcion-corta` ni `release/<versión>`");
  return ok;
}

/**
 * Un pull request de `head` hacia `into`. La de integración recibe cualquier
 * rama con buen nombre. `main` no recibe ninguno: la actualiza
 * `star release finish` con cada versión (decisión 19), y el repo sólo permite
 * squash, que en `main` aplastaría toda la historia de la base.
 */
export function checkPullRequest(head: string, into: string, base: string): Verdict {
  if (into === "main") {
    return fail(
      "main no recibe pull requests: la actualiza `star release finish` con cada versión",
    );
  }
  // Un PR encima de otro PR se mergea en la rama del otro, y si el de abajo
  // ya entró, el cambio no llega nunca a la base. Le pasó a flotas#2.
  if (into !== base) {
    return fail(`un pull request va a ${base}, no a ${into}`);
  }
  return checkBranch(head);
}

const ZERO = /^0+$/;

/**
 * Lo que git le pasa por stdin al hook `pre-push`: una línea por ref,
 * `<ref local> <sha local> <ref remota> <sha remoto>`.
 *
 * Un push de tag nunca se frena: publicar es empujar un tag que apunta a un
 * commit que ya llegó a la base por un pull request. Borrar una rama remota
 * después de mergear su PR es limpieza, no un cambio.
 */
export function checkPush(stdin: string, base: string): { ref: string; verdict: Verdict }[] {
  const protectedBranches = new Set(["main", base]);
  const results: { ref: string; verdict: Verdict }[] = [];
  for (const line of stdin.split(/\r?\n/)) {
    const [, localSha, remoteRef] = line.trim().split(/\s+/);
    if (!remoteRef?.startsWith("refs/heads/") || !localSha || ZERO.test(localSha)) continue;
    const branch = remoteRef.slice("refs/heads/".length);
    const verdict = protectedBranches.has(branch)
      ? fail(`no se empuja directo a ${branch}: todo cambio llega por un pull request`)
      : checkBranch(branch);
    results.push({ ref: branch, verdict });
  }
  return results;
}

export const SUBJECT_HELP = `Sólo se aceptan dos formas:

  tipo(scope): asunto en inglés, minúscula, sin punto al final, hasta ${MAX_SUBJECT} caracteres
  0.4.0        la versión sola, en el commit que la sube

Tipos: ${TYPES.join(" ")}

Ejemplos:
  feat(machines): archive a machine instead of deleting it
  fix(auth): keep the active organization after a password reset
  chore(deps): bump hono to 4.14

El cuerpo es libre, y es donde va el porqué.`;

export const BRANCH_HELP = `Una rama es tipo/descripcion-corta, en inglés, minúscula y kebab-case, hasta
${MAX_BRANCH} caracteres, o release/<versión> para subir la versión:

  feat/document-upload
  fix/expired-alert-timezone
  release/0.2.0

Renómbrala con:  git branch -m <nombre-nuevo>`;
