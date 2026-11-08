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
 *
 * `--yes` (o STAR_YES=1) contesta que sí cuando no hay terminal donde preguntar.
 */
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { changelogSection, readChangelog, today } from "./changelog.ts";
import { StarError } from "./errors.ts";
import { ghIn } from "./gh.ts";
import { gitIn } from "./git.ts";
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

async function release(
  root: string,
  sub: string | undefined,
  arg: string | undefined,
  yes: boolean,
) {
  if (sub === "finish") return finishRelease(releaseDeps(root, yes), arg);
  if (sub !== undefined && !isLevel(sub)) {
    throw new StarError(`"${sub}" no es un nivel ni "finish". Usa patch, minor, major o finish.`);
  }
  const level = sub ?? (await chooseLevel(currentVersion(inspect(root)), "star release"));
  return prepareRelease(releaseDeps(root, yes), level);
}

export async function main(argv: string[], root = process.cwd()): Promise<void> {
  const yes = argv.includes("--yes") || process.env.STAR_YES === "1";
  const [command, sub, arg] = argv.filter((a) => a !== "--yes");

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
      return release(root, sub, arg, yes);
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
