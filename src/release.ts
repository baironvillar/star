import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { changelogSection, copyUnreleased, promoteUnreleased, readChangelog } from "./changelog.ts";
import { readConfig } from "./config.ts";
import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";
import type { Git } from "./git.ts";
import { hasOwnVersion } from "./manifests/types.ts";
import type { Readiness } from "./readiness.ts";
import { formatVersion, isPrerelease, type Level, nextVersion, parseVersion } from "./semver.ts";
import {
  applyChanges,
  currentVersion,
  disagreements,
  type Entry,
  inspect,
  planWrite,
} from "./version.ts";

/**
 * Publicar una versión, en dos fases.
 *
 * **Por qué dos y no una.** El bump vuelve a `develop` por un pull request,
 * como cualquier cambio, y se mergea con squash: el commit que llega a
 * `develop` no es el de la rama. El tag tiene que ir sobre el que llegó, así
 * que no se puede crear hasta después del merge.
 *
 *   star release minor     desde develop: chequeos, puerta, rama, bump, commit, push y PR
 *   star release finish    cuando el CI pasa: squash con el asunto exacto, tag y push
 *
 * `finish` mergea el PR él mismo para que el asunto sea la versión y nada más.
 * Mergeado a mano, GitHub le agrega el número del PR, y el workflow de release
 * rechaza ese commit: GitHub titula la corrida de un tag con su asunto.
 */

export type Io = {
  log(message: string): void;
  warn(message: string): void;
  /** Pregunta sí o no. Lanza si no hay nadie para contestar. */
  confirm(question: string): Promise<boolean>;
};

export type ReleaseDeps = {
  root: string;
  git: Git;
  gh: Gh;
  io: Io;
  /** Corre los comandos de la puerta en orden. Devuelve si pasaron todos. */
  runGate(commands: string[]): boolean;
  today(): string;
};

function fail(title: string, problems: string[]): never {
  throw new StarError(`${title}\n\n${problems.map((p) => `  - ${p}`).join("\n")}`);
}

/** Las líneas de `git status --porcelain` de archivos con seguimiento, menos las permitidas. */
function trackedChanges(lines: string[], allowed: string[]): string[] {
  return lines
    .filter((line) => !line.startsWith("??"))
    .filter((line) => !allowed.includes(line.slice(3).trim().replace(/^"|"$/g, "")));
}

function checkTag(git: Git, tag: string, problems: string[], warnings: string[]) {
  if (git.localTagExists(tag)) {
    problems.push(`el tag ${tag} ya existe: ese número ya se publicó.`);
    return;
  }
  // El tag local puede faltar sólo porque no se hizo fetch. El remoto es el que
  // importa: es donde el push del tag va a chocar.
  const remote = git.remoteTagExists(tag);
  if (remote === true)
    problems.push(`el tag ${tag} ya existe en origin: ese número ya se publicó.`);
  if (remote === null) warnings.push(`no se pudo revisar si ${tag} existe en origin.`);
}

export type PrepareCheck = Readiness & {
  /** Las notas de la versión, si las hay. */
  notes: string | null;
  /**
   * El changelog con lo "sin publicar" convertido en la sección de la versión
   * (o copiado, en una beta), si hace falta.
   */
  promoted: string | null;
};

/**
 * Si se puede preparar `next` desde acá.
 *
 * Cada problema es una forma de que la versión salga mal, y es más barato
 * atraparlo antes de crear la rama que después de empujarla.
 */
export function checkPrepare(input: {
  entries: Entry[];
  current: string;
  next: string;
  base: string;
  changelog: string;
  today: string;
  gate: string[] | null;
  git: Git;
}): PrepareCheck {
  const { entries, current, next, base, changelog, git } = input;
  const problems: string[] = [];
  const warnings: string[] = [];

  const branch = git.branch();
  if (branch !== base) {
    problems.push(
      `la versión sale de '${base}' y estás en '${branch || "HEAD suelto"}'. Cámbiate con \`git switch ${base}\`.`,
    );
  } else {
    const ahead = git.ahead(`origin/${base}`);
    const behind = git.behind(`origin/${base}`);
    if (ahead !== null && ahead > 0) {
      problems.push(
        `${base} tiene ${ahead} commit(s) que no están en origin, y en ${base} no se commitea: todo llega por pull request.`,
      );
    }
    if (behind !== null && behind > 0) {
      problems.push(
        `origin/${base} tiene ${behind} commit(s) que no tienes: haz \`git pull\` antes.`,
      );
    }
    if (ahead === null || behind === null)
      warnings.push(`no se pudo comparar ${base} con origin/${base}.`);
  }

  // El changelog puede venir con cambios: las notas se escriben justo antes, y
  // viajan en el mismo commit que el número.
  const dirty = trackedChanges(git.dirty(), ["CHANGELOG.md"]);
  if (dirty.length > 0) {
    problems.push(
      `hay cambios sin commitear fuera del CHANGELOG.md:\n${dirty.map((l) => `      ${l}`).join("\n")}`,
    );
  }

  const wrong = disagreements(entries, current);
  if (wrong.length > 0) {
    const list = wrong
      .map((e) => `${e.manifest.label} dice ${hasOwnVersion(e.state) ? e.state.version : "?"}`)
      .join(", ");
    problems.push(
      `los manifiestos no coinciden con ${current}: ${list}. Arréglalo con \`star version set ${current}\`.`,
    );
  }

  checkTag(git, `v${next}`, problems, warnings);

  const releaseBranch = `release/${next}`;
  if (git.localBranchExists(releaseBranch)) {
    problems.push(
      `la rama ${releaseBranch} ya existe. Si es de un intento anterior, bórrala con \`git branch -D ${releaseBranch}\`.`,
    );
  }
  if (git.remoteBranchExists(releaseBranch) === true) {
    problems.push(
      `la rama ${releaseBranch} ya existe en origin: ¿hay un PR de esa versión abierto?`,
    );
  }

  let notes = changelogSection(changelog, next);
  let promoted: string | null = null;
  if (!notes) {
    promoted = isPrerelease(next)
      ? copyUnreleased(changelog, next, input.today)
      : promoteUnreleased(changelog, next, input.today);
    notes = promoted ? changelogSection(promoted, next) : null;
  }
  if (!notes) {
    problems.push(
      `CHANGELOG.md no tiene notas para la ${next}, ni nada en "## [Sin publicar]". Escríbelas antes: la versión no sale sin ellas.`,
    );
  }

  if (input.gate === null) {
    problems.push(
      'no sé qué correr antes de publicar. Configura "star": { "gate": [...] } en package.json (por ejemplo "biome check" y "bun test").',
    );
  } else if (input.gate.length === 0) {
    warnings.push('"star.gate" está vacío: la versión sale sin lint ni tests.');
  }

  return { problems, warnings, notes, promoted };
}

/** Fase 1: deja la versión en un PR, lista para mergear. */
export async function prepareRelease(
  deps: ReleaseDeps,
  level: Level | "beta",
  beta = false,
): Promise<void> {
  const { root, git, gh, io } = deps;
  const config = readConfig(root);
  if (!git.fetch())
    io.warn(
      "no se pudo traer lo nuevo de origin: los chequeos contra el remoto pueden estar atrasados.",
    );

  const entries = inspect(root);
  const current = currentVersion(entries);
  const next = formatVersion(nextVersion(parseVersion(current, "la versión actual"), level, beta));
  const check = checkPrepare({
    entries,
    current,
    next,
    base: config.base,
    changelog: readChangelog(root),
    today: deps.today(),
    gate: config.gate,
    git,
  });

  const ghReady = gh.available();
  if (!ghReady)
    check.warnings.push("gh no está instalado o no tiene sesión: el PR lo vas a abrir a mano.");
  for (const warning of check.warnings) io.warn(warning);
  if (check.problems.length > 0) fail(`La ${next} todavía no se puede preparar:`, check.problems);

  // La puerta corre después de los chequeos baratos y antes de preguntar: no
  // tiene sentido esperar los tests de una versión que igual no puede salir.
  const gate = config.gate ?? [];
  if (gate.length > 0) {
    io.log(`\nPuerta: ${gate.join(" → ")}\n`);
    if (!deps.runGate(gate)) throw new StarError("La puerta no pasó. No se preparó nada.");
  }

  const changes = planWrite(entries, next);
  const branch = `release/${next}`;
  const changelogPath = join(root, "CHANGELOG.md");

  io.log(`\n${current} → ${next}\n`);
  for (const change of changes) io.log(`  ${change.manifest.label}`);
  if (check.promoted) {
    io.log(
      isPrerelease(next)
        ? `  CHANGELOG.md  (se copia "Sin publicar" a la ${next}, y se queda para la versión final)`
        : `  CHANGELOG.md  ("Sin publicar" pasa a ser la ${next})`,
    );
  }
  if (isPrerelease(next)) {
    io.log(`\nLa ${next} sale como prerelease: la app instalada no la ve, se prueba a mano.`);
  }
  io.log(`\n${check.notes}\n`);
  io.log(
    `Se crea ${branch}, se commitea "${next}" y se empuja${ghReady ? `, y se abre el PR a ${config.base}` : ""}.\n`,
  );
  if (!(await io.confirm(`¿Preparar la ${next}?`))) {
    io.log("No se cambió nada.");
    return;
  }

  git.switchCreate(branch);
  try {
    applyChanges(changes);
    if (check.promoted) writeFileSync(changelogPath, check.promoted, "utf8");
    git.add([...changes.map((c) => c.manifest.path), changelogPath]);
    git.commit(next);
    git.push(["-u", "origin", branch]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new StarError(
      `${reason}\n\nQuedaste en la rama ${branch}. Revisa \`git status\` antes de volver a intentarlo.`,
    );
  }

  if (ghReady) {
    const url = gh.createPr({
      base: config.base,
      head: branch,
      title: next,
      body: check.notes ?? "",
    });
    io.log(`\n✓ PR abierto: ${url}`);
  } else {
    io.log(`\n✓ ${branch} empujada. Abre el PR a ${config.base} con el título "${next}".`);
  }
  io.log(`\nCuando el CI del PR pase:\n\n  bunx star release finish\n`);
}

/** Fase 2: mergea el PR con el asunto exacto, y etiqueta lo que llegó a la base. */
export async function finishRelease(deps: ReleaseDeps, versionArg?: string): Promise<void> {
  const { root, git, gh, io } = deps;
  const config = readConfig(root);
  if (!git.fetch()) io.warn("no se pudo traer lo nuevo de origin.");

  const branchNow = git.branch();
  let raw = versionArg ?? /^release\/(.+)$/.exec(branchNow)?.[1];
  if (!raw && branchNow === config.base) {
    git.pullFastForward();
    raw = currentVersion(inspect(root));
  }
  if (!raw) {
    throw new StarError(
      "¿Qué versión? Córrelo desde la rama release/<versión>, o dila: `star release finish 0.2.0`.",
    );
  }
  const version = formatVersion(parseVersion(raw.replace(/^v/, ""), "la versión"));
  const head = `release/${version}`;
  const tag = `v${version}`;

  const problems: string[] = [];
  const warnings: string[] = [];
  checkTag(git, tag, problems, warnings);
  const dirty = trackedChanges(git.dirty(), []);
  if (dirty.length > 0) problems.push("hay cambios sin commitear: commitéalos o guárdalos antes.");

  const ghReady = gh.available();
  const pr = ghReady ? gh.findPr(head) : null;
  if (!ghReady) {
    warnings.push(`sin gh no puedo ver el PR de ${head}: se asume que ya está mergeado.`);
  } else if (!pr) {
    problems.push(`no hay un PR de ${head}. La versión se prepara con \`star release\`.`);
  } else if (pr.state === "CLOSED") {
    problems.push(`el PR #${pr.number} se cerró sin mergear: ${pr.url}`);
  } else if (pr.state === "OPEN") {
    if (pr.checks === "failing") problems.push(`el CI del PR #${pr.number} falló: ${pr.url}`);
    if (pr.checks === "pending") {
      problems.push(
        `el CI del PR #${pr.number} todavía corre. Vuelve a intentarlo cuando termine.`,
      );
    }
    if (pr.checks === "none")
      warnings.push(`el PR #${pr.number} no tiene checks: nada probó este commit.`);
    if (pr.mergeable === false)
      problems.push(`el PR #${pr.number} tiene conflictos con ${config.base}.`);
  }

  for (const warning of warnings) io.warn(warning);
  if (problems.length > 0) fail(`La ${version} todavía no se puede terminar:`, problems);

  const merge = pr?.state === "OPEN" ? pr : null;
  io.log(
    merge
      ? `\nSe mergea el PR #${merge.number} con squash como "${version}", se actualiza ${config.base} y se empuja ${tag}.\n`
      : `\nSe actualiza ${config.base} y se empuja ${tag} sobre su último commit.\n`,
  );
  if (!(await io.confirm(`¿Terminar la ${version}?`))) {
    io.log("No se cambió nada.");
    return;
  }

  if (merge) gh.mergeSquash(merge.number, version);
  if (git.branch() !== config.base) git.switchTo(config.base);
  git.pullFastForward();

  // Se verifica lo que llegó, no lo que se supone que llegó.
  const after: string[] = [];
  const subject = git.headSubject();
  if (subject !== version) {
    after.push(
      `el último commit de ${config.base} se llama "${subject}" y tendría que llamarse "${version}". El workflow de release lo rechaza, porque GitHub titula la corrida del tag con ese asunto.`,
    );
  }
  const entries = inspect(root);
  const current = currentVersion(entries);
  if (current !== version) after.push(`${config.base} dice ${current}, no ${version}.`);
  if (disagreements(entries, current).length > 0)
    after.push("los manifiestos de la base no coinciden.");
  if (!changelogSection(readChangelog(root), version)) {
    after.push(`CHANGELOG.md de ${config.base} no tiene notas para la ${version}.`);
  }
  if (after.length > 0) fail(`No se creó el tag ${tag}:`, after);

  git.tag(tag, version);
  git.push(["origin", tag]);
  io.log(`\n✓ ${tag} empujado. Desde acá sigue el workflow de release.\n`);
}
