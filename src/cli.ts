#!/usr/bin/env bun
/**
 * star: el kit de releases.
 *
 *   star version                    la versión, y falla si algún manifiesto discrepa
 *   star version bump [nivel]       sube la versión, con chequeos, y pregunta antes
 *   star version set <x.y.z>        fija una versión (para reparar manifiestos)
 *   star version tag <tag>          falla si el tag no coincide con la versión (CI)
 *   star notes [versión]            la sección del CHANGELOG de esa versión
 *   star release [nivel]            prepara una versión: rama, bump, commit, push y PR
 *   star release finish [versión]   la mergea con el asunto exacto y empuja el tag
 *   star release check <tag>        revisa latest.json y las firmas de una release de escritorio
 *   star init hooks                 instala commit-msg y pre-push en .githooks
 *   star init changelog             crea un CHANGELOG.md vacío, si no hay uno
 *   star hook <nombre> [args]       lo que corre un hook de git (no se llama a mano)
 *   star lint commits [rango]       revisa los mensajes de commit (CI)
 *   star lint branch <rama>         revisa el nombre de una rama (CI)
 *   star doctor                     qué falta o está mal en la app
 *   star verify <tag>               todo lo que se revisa antes de construir un tag (CI)
 *
 * `--yes` (o STAR_YES=1) contesta que sí cuando no hay terminal donde preguntar.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { changelogSection, EMPTY_CHANGELOG, readChangelog, today } from "./changelog.ts";
import { readConfig } from "./config.ts";
import {
  BRANCH_HELP,
  checkBranch,
  checkMessage,
  checkPullRequest,
  checkPush,
  SUBJECT_HELP,
  subjectOf,
} from "./conventions.ts";
import { StarError } from "./errors.ts";
import { ghIn } from "./gh.ts";
import { diagnose } from "./doctor.ts";
import { checkPublishedFiles, parsePlatforms } from "./updater.ts";
import { verifyTag } from "./verify.ts";
import { gitIn } from "./git.ts";
import { HOOKS_DIR, inspectHooks, installHooks, lintCommits } from "./hooks.ts";
import { hasOwnVersion } from "./manifests/types.ts";
import { confirm, ask, interactive } from "./prompt.ts";
import { checkReady } from "./readiness.ts";
import { finishRelease, prepareRelease, type ReleaseDeps } from "./release.ts";
import { bump, formatVersion, isLevel, LEVELS, type Level, parseVersion } from "./semver.ts";
import {
  applyChanges,
  currentVersion,
  disagreements,
  type Entry,
  inspect,
  planWrite,
} from "./version.ts";

const HELP = `star ${pkg.version}: el kit de releases

Uso:
  star version                 la versión, y falla si algún manifiesto discrepa
  star version bump [nivel]    sube la versión (patch | minor | major), con chequeos
  star version set <x.y.z>     fija una versión en todos los manifiestos
  star version tag <tag>       falla si el tag no coincide con la versión
  star notes [versión]         las notas de esa versión en CHANGELOG.md
  star release [nivel]         prepara una versión desde develop: puerta, rama
                               release/<versión>, bump, commit, push y PR
  star release finish [ver.]   cuando el CI pasa: squash con la versión como
                               asunto, actualiza develop y empuja el tag
  star release check <tag>     app de escritorio: latest.json tiene cada
                               plataforma (--platforms windows,linux), apunta a
                               archivos de la release y con sus firmas
  star init hooks              instala commit-msg y pre-push en .githooks y
                               apunta git ahí (core.hooksPath)
  star init changelog          crea un CHANGELOG.md con "## [Sin publicar]"
  star lint commits [rango]    revisa los mensajes de base..head, o de un commit
  star lint branch <rama>      revisa el nombre de una rama; con --into <base>,
                               también hacia dónde va el pull request
  star doctor                  qué falta o está mal en la app, y cómo arreglarlo
  star verify <tag>            antes de construir un tag: el commit se llama
                               como la versión, el tag coincide, hay notas y
                               pasa la puerta. Con --notes-file <ruta> escribe
                               las notas ahí

Opciones:
  --yes                        contesta que sí cuando no hay terminal (o STAR_YES=1)
  -h, --help                   esta ayuda
  -v, --version                la versión de star
`;

function report(entries: Entry[], version: string): boolean {
  const width = Math.max(...entries.map((e) => e.manifest.label.length));
  for (const { manifest, state } of entries) {
    const value = hasOwnVersion(state) ? state.version : `→ ${state.linkedTo}`;
    const mark = hasOwnVersion(state) && state.version !== version ? "  ✗" : "";
    console.log(`  ${manifest.label.padEnd(width)}  ${value}${mark}`);
  }
  const wrong = disagreements(entries, version);
  if (wrong.length > 0) {
    console.error(
      `\n✗ No coinciden con ${version}. Arréglalo con \`star version set ${version}\`.`,
    );
    return false;
  }
  console.log(`\n✓ ${version}`);
  return true;
}

async function chooseLevel(current: string, command: string): Promise<Level> {
  if (!interactive()) {
    throw new StarError(
      `no hay una terminal donde preguntar el nivel. Dilo: \`${command} patch|minor|major\`.`,
    );
  }
  console.log(`La versión actual es ${current}. ¿Cuál sale?\n`);
  for (const level of ["patch", "minor", "major"] as const) {
    console.log(`  ${level.padEnd(5)}  ${LEVELS[level]}`);
  }
  const answer = (await ask("\npatch | minor | major: ")).toLowerCase();
  if (!isLevel(answer)) {
    throw new StarError(
      `"${answer}" no es un nivel. El número no lo decide el diff: lo decide qué cambió.`,
    );
  }
  return answer;
}

/** Pregunta, salvo que ya se haya dicho que sí. Devuelve si hay que seguir. */
async function goAhead(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  const answer = await confirm(question);
  if (answer === "unanswered") {
    throw new StarError(
      "no había nadie para contestar. Córrelo desde una terminal, o con --yes si ya lo revisaste.",
    );
  }
  if (answer === "no") console.log("No se cambió nada.");
  return answer === "yes";
}

async function versionBump(root: string, levelArg: string | undefined, yes: boolean) {
  if (levelArg !== undefined && !isLevel(levelArg)) {
    throw new StarError(`"${levelArg}" no es un nivel. Usa patch, minor o major.`);
  }
  const entries = inspect(root);
  const current = currentVersion(entries);
  const level = levelArg ?? (await chooseLevel(current, "star version bump"));
  const next = formatVersion(bump(parseVersion(current, "la versión actual"), level));
  const changelog = readChangelog(root);

  const { problems, warnings } = checkReady({
    entries,
    current,
    next,
    changelog,
    git: gitIn(root),
  });
  for (const warning of warnings) console.warn(`! ${warning}`);
  if (problems.length > 0) {
    console.error(`\n✗ La ${next} todavía no se puede subir:\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("");
    process.exit(1);
  }

  const changes = planWrite(entries, next);
  console.log(`\n${current} → ${next}\n`);
  for (const change of changes) console.log(`  ${change.manifest.label}`);
  console.log(`\n${changelogSection(changelog, next)}\n`);

  if (!(await goAhead(`¿Escribir la ${next} en estos archivos?`, yes))) return;
  applyChanges(changes);
  console.log(
    `\n✓ ${next}. Ahora:\n\n  git commit -am "${next}"\n  git push -u origin release/${next}\n`,
  );
}

async function versionSet(root: string, raw: string | undefined, yes: boolean) {
  if (!raw) throw new StarError("falta la versión: `star version set 0.2.0`.");
  // **Más liviano que el bump a propósito.** `set` es la herramienta para
  // reparar manifiestos que se desincronizaron, y un árbol que hay que reparar
  // tiene cambios en esos archivos: exigir un árbol limpio lo dejaría sin
  // entrada. Lo que no hace es elegir un número: está en el argumento.
  const next = formatVersion(parseVersion(raw, "el argumento"));
  const entries = inspect(root);
  const changes = planWrite(entries, next);
  if (changes.length === 0) {
    console.log(`✓ Todos los manifiestos ya dicen ${next}.`);
    return;
  }
  for (const change of changes) console.log(`  ${change.manifest.label}`);
  if (!(await goAhead(`¿Fijar la versión en ${next}?`, yes))) return;
  applyChanges(changes);
  console.log(`✓ ${next}`);
}

function versionTag(root: string, tag: string | undefined) {
  if (!tag) throw new StarError("falta el tag: `star version tag v0.2.0`.");
  const entries = inspect(root);
  const version = currentVersion(entries);
  if (disagreements(entries, version).length > 0) {
    report(entries, version);
    process.exit(1);
  }
  // Un tag que no coincide con los manifiestos publica un número en la release
  // y otro adentro de lo que se instala.
  if (tag !== `v${version}`)
    throw new StarError(`el tag ${tag} no coincide con la versión v${version}.`);
  console.log(`✓ ${tag}`);
}

function notes(root: string, raw: string | undefined) {
  const version = raw
    ? formatVersion(parseVersion(raw.replace(/^v/, ""), "el argumento"))
    : currentVersion(inspect(root));
  const section = changelogSection(readChangelog(root), version);
  if (!section) throw new StarError(`CHANGELOG.md no tiene notas en "## [${version}]".`);
  // Sólo las notas van a stdout: el workflow lo redirige al cuerpo de la release.
  console.log(section);
}

/**
 * Corre la puerta con `node_modules/.bin` en el PATH.
 *
 * Bajo `bun run` o `vp run` ya está, pero `bunx star` no lo agrega, y entonces
 * `vp check` no se encontraría. En Windows la variable se llama `Path`, y copiar
 * `process.env` a un objeto pierde que no distinga mayúsculas: se busca la clave
 * que haya.
 */
function runGate(root: string, commands: string[]): boolean {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[key] = [join(root, "node_modules", ".bin"), env[key]].filter(Boolean).join(delimiter);
  for (const command of commands) {
    console.log(`$ ${command}`);
    const r = spawnSync(command, { cwd: root, env, shell: true, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`\n✗ Falló: ${command}`);
      return false;
    }
  }
  return true;
}

function releaseDeps(root: string, yes: boolean): ReleaseDeps {
  return {
    root,
    git: gitIn(root),
    gh: ghIn(root),
    runGate: (commands) => runGate(root, commands),
    today: () => today(),
    io: {
      log: (message) => console.log(message),
      warn: (message) => console.warn(`! ${message}`),
      async confirm(question) {
        if (yes) return true;
        const answer = await confirm(question);
        if (answer === "unanswered") {
          throw new StarError(
            "no había nadie para contestar. Córrelo desde una terminal, o con --yes si ya lo revisaste.",
          );
        }
        return answer === "yes";
      },
    },
  };
}

function releaseCheck(root: string, tag: string | undefined, platforms = "windows,linux") {
  if (!tag) throw new StarError("falta el tag: `star release check v0.2.0`.");
  const version = tag.replace(/^v/, "");
  const notes = changelogSection(readChangelog(root), version);
  if (!notes) throw new StarError(`CHANGELOG.md no tiene notas en "## [${version}]".`);
  const problems = checkPublishedFiles(ghIn(root), {
    tag,
    notes,
    platforms: parsePlatforms(platforms),
  });
  if (problems.length > 0) {
    throw new StarError(
      `La release ${tag} no se puede publicar así:\n\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  console.log(`✓ ${tag}: latest.json apunta a sus archivos, con sus firmas.`);
}

async function release(
  root: string,
  sub: string | undefined,
  arg: string | undefined,
  yes: boolean,
  platforms?: string,
) {
  if (sub === "finish") return finishRelease(releaseDeps(root, yes), arg);
  if (sub === "check") return releaseCheck(root, arg, platforms);
  if (sub !== undefined && !isLevel(sub)) {
    throw new StarError(`"${sub}" no es un nivel ni "finish". Usa patch, minor, major o finish.`);
  }
  const level = sub ?? (await chooseLevel(currentVersion(inspect(root)), "star release"));
  return prepareRelease(releaseDeps(root, yes), level);
}

async function initHooks(root: string, yes: boolean) {
  const git = gitIn(root);
  const hooks = inspectHooks(root);
  const different = hooks.filter((h) => h.state === "different");
  if (different.length > 0) {
    // Lo que ya hay puede ser la copia vieja de la convención, o un hook propio
    // de la app: no se pisa sin preguntar.
    console.log(`Ya hay hooks con otro contenido en ${HOOKS_DIR}:\n`);
    for (const hook of different) console.log(`  ${HOOKS_DIR}/${hook.name}`);
    console.log("\nstar los reemplaza por una línea que llama a `star hook`.\n");
    if (!(await goAhead("¿Reemplazarlos?", yes))) return;
  }
  const { fileModeOff } = installHooks(root, git, hooks);
  for (const hook of hooks) {
    const what = { missing: "creado", different: "reemplazado", same: "al día" }[hook.state];
    console.log(`  ${HOOKS_DIR}/${hook.name}  ${what}`);
  }
  console.log(`\n✓ git usa ${HOOKS_DIR} (core.hooksPath).`);
  if (fileModeOff) {
    console.log(
      "  Se apagó core.filemode: Windows no guarda el bit de ejecución, y con eso\n" +
        "  prendido git veía los hooks como cambiados a 644.",
    );
  }
  console.log("  Los hooks quedaron en el stage, como ejecutables: si cambiaron, commitéalos.");
}

function initChangelog(root: string) {
  const path = join(root, "CHANGELOG.md");
  // Un changelog que ya existe tiene la historia de la app: nunca se pisa.
  if (existsSync(path)) {
    console.log("✓ Ya hay un CHANGELOG.md; no se tocó.");
    return;
  }
  writeFileSync(path, EMPTY_CHANGELOG);
  console.log('✓ CHANGELOG.md creado. Anota lo próximo en "## [Sin publicar]".');
}

function failSubject(subject: string, reason: string): never {
  throw new StarError(
    `El mensaje de commit no cumple la convención: ${reason}.\n\n  asunto: "${subject}"\n\n${SUBJECT_HELP}`,
  );
}

async function hook(root: string, name: string | undefined, arg: string | undefined) {
  switch (name) {
    case "commit-msg": {
      if (!arg) throw new StarError("git le pasa al hook commit-msg el archivo del mensaje.");
      const message = readFileSync(arg, "utf8");
      const verdict = checkMessage(message);
      if (!verdict.ok) failSubject(subjectOf(message), verdict.reason);
      return;
    }
    case "pre-push": {
      const { base } = readConfig(root);
      const failed = checkPush(await Bun.stdin.text(), base).filter((r) => !r.verdict.ok);
      if (failed.length === 0) return;
      const lines = failed.map((r) => `  ${r.ref}: ${r.verdict.ok ? "" : r.verdict.reason}`);
      // A una rama protegida no le sirve la ayuda de cómo renombrar: le sirve
      // saber cómo sacar el cambio a su propia rama.
      const help = failed.some((r) => r.ref === base || r.ref === "main")
        ? `Todo cambio llega a ${base} por un pull request desde su propia rama:\n\n  git switch -c fix/short-description\n  git push -u origin fix/short-description`
        : BRANCH_HELP;
      throw new StarError(
        `Este push no sigue la convención de ramas:\n\n${lines.join("\n")}\n\n${help}`,
      );
    }
    default:
      throw new StarError(`"hook ${name ?? ""}" no existe. Los hooks son commit-msg y pre-push.`);
  }
}

function lint(root: string, what: string | undefined, arg: string | undefined, into?: string) {
  switch (what) {
    case "commits": {
      const { onlyTip, results } = lintCommits(gitIn(root), arg ?? "HEAD");
      if (onlyTip) {
        // Es lo normal en el primer push de una rama o después de un force-push,
        // pero se dice: un rango mal escrito no puede pasar por uno revisado.
        console.warn("! La base del rango no está en este clon: se revisa sólo la punta.");
      }
      for (const r of results) {
        console.log(`  ${r.verdict.ok ? "✓" : "✗"} ${r.sha.slice(0, 12)}  ${r.subject}`);
      }
      const failed = results.filter((r) => !r.verdict.ok);
      if (failed.length === 0) return;
      const lines = failed.map(
        (r) => `  ${r.sha.slice(0, 12)}: ${r.verdict.ok ? "" : r.verdict.reason}`,
      );
      throw new StarError(
        `Hay commits fuera de la convención:\n\n${lines.join("\n")}\n\n${SUBJECT_HELP}`,
      );
    }
    case "branch": {
      if (!arg) throw new StarError("falta la rama: `star lint branch feat/algo`.");
      const verdict = into ? checkPullRequest(arg, into, readConfig(root).base) : checkBranch(arg);
      if (!verdict.ok) {
        throw new StarError(
          `La rama "${arg}" no sigue la convención: ${verdict.reason}.\n\n${BRANCH_HELP}`,
        );
      }
      console.log(`✓ ${arg}${into ? ` → ${into}` : ""}`);
      return;
    }
    default:
      throw new StarError(`"lint ${what ?? ""}" no existe. Usa commits o branch.`);
  }
}

function doctor(root: string) {
  const findings = diagnose({ root, git: gitIn(root), gh: ghIn(root) });
  const width = Math.max(...findings.map((f) => f.area.length));
  const mark = { ok: "✓", warn: "!", error: "✗" };
  for (const f of findings) {
    console.log(`  ${mark[f.level]} ${f.area.padEnd(width)}  ${f.message}`);
    if (f.fix && f.level !== "ok") console.log(`    ${" ".repeat(width)}  → ${f.fix}`);
  }
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.filter((f) => f.level === "warn").length;
  if (errors > 0) {
    throw new StarError(`${errors} problema(s) y ${warnings} aviso(s).`);
  }
  console.log(warnings > 0 ? `\n! ${warnings} aviso(s), nada que frene.` : "\n✓ Todo en orden.");
}

function verify(root: string, tag: string | undefined, notesFile: string | undefined) {
  if (!tag) throw new StarError("falta el tag: `star verify v0.2.0`.");
  const { version, notes } = verifyTag(
    {
      root,
      git: gitIn(root),
      runGate: (commands) => runGate(root, commands),
      log: (message) => console.log(message),
    },
    tag,
  );
  if (notesFile) writeFileSync(notesFile, `${notes}\n`);
  // En GitHub Actions la versión sale como output del paso, para los jobs que
  // vienen después (el título de la release, el tag de una imagen).
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`\n✓ ${tag} se puede construir.`);
}

/** Saca `--opcion valor` de los argumentos y devuelve el valor. */
function takeOption(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  if (value === undefined) throw new StarError(`a ${name} le falta el valor.`);
  return value;
}

export async function main(argv: string[], root = process.cwd()): Promise<void> {
  const yes = argv.includes("--yes") || process.env.STAR_YES === "1";
  const args = argv.filter((a) => a !== "--yes");
  const into = takeOption(args, "--into");
  const notesFile = takeOption(args, "--notes-file");
  const platforms = takeOption(args, "--platforms");
  const [command, sub, arg] = args;

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return;
    case "-v":
    case "--version":
      console.log(pkg.version);
      return;
    case "version":
      switch (sub) {
        case undefined:
        case "get": {
          const entries = inspect(root);
          if (!report(entries, currentVersion(entries))) process.exit(1);
          return;
        }
        case "bump":
          return versionBump(root, arg, yes);
        case "set":
          return versionSet(root, arg, yes);
        case "tag":
          return versionTag(root, arg);
        default:
          throw new StarError(`"version ${sub}" no existe. Usa get, bump, set o tag.`);
      }
    case "notes":
      return notes(root, sub);
    case "release":
      return release(root, sub, arg, yes, platforms);
    case "init":
      if (sub === "hooks") return initHooks(root, yes);
      if (sub === "changelog") return initChangelog(root);
      throw new StarError(`"init ${sub ?? ""}" no existe. Usa init hooks o init changelog.`);
    case "hook":
      return hook(root, sub, arg);
    case "lint":
      return lint(root, sub, arg, into);
    case "doctor":
      return doctor(root);
    case "verify":
      return verify(root, sub, notesFile);
    default:
      throw new StarError(`"${command}" no es un comando. Mira \`star --help\`.`);
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof StarError) {
      console.error(`\n✗ ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
