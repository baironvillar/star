import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changelogSection, readChangelog } from "./changelog.ts";
import { readConfig } from "./config.ts";
import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";
import type { Git } from "./git.ts";
import { HOOK_NAMES, HOOKS_DIR, inspectHooks } from "./hooks.ts";
import { currentVersion, disagreements, inspect } from "./version.ts";

/**
 * `ok` está bien; `warn` funciona pero algo va a doler; `error` hace que
 * `release` o la CI fallen, o que algo se filtre.
 */
export type Level = "ok" | "warn" | "error";
export type Finding = { area: string; level: Level; message: string; fix?: string };

export type DoctorDeps = { root: string; git: Git; gh: Gh };

const ok = (area: string, message: string): Finding => ({ area, level: "ok", message });
const warn = (area: string, message: string, fix?: string): Finding => ({
  area,
  level: "warn",
  message,
  fix,
});
const error = (area: string, message: string, fix?: string): Finding => ({
  area,
  level: "error",
  message,
  fix,
});

/** Corre un chequeo; si lanza un StarError, el mensaje es el hallazgo. */
function guard(area: string, check: () => Finding[]): Finding[] {
  try {
    return check();
  } catch (e) {
    if (e instanceof StarError) return [error(area, e.message)];
    throw e;
  }
}

function manifests(root: string): Finding[] {
  const entries = inspect(root);
  const version = currentVersion(entries);
  const wrong = disagreements(entries, version);
  if (wrong.length > 0) {
    return [
      error(
        "versión",
        `${wrong.map((e) => e.manifest.label).join(", ")} no dicen ${version}`,
        `star version set ${version}`,
      ),
    ];
  }
  return [ok("versión", `${version} en ${entries.length} manifiesto(s)`)];
}

function changelog(root: string, git: Git): Finding[] {
  if (!existsSync(join(root, "CHANGELOG.md"))) {
    return [
      error(
        "changelog",
        "no hay un CHANGELOG.md: las notas de cada versión viven ahí",
        "bunx star init changelog",
      ),
    ];
  }
  const md = readChangelog(root);
  const version = currentVersion(inspect(root));
  const findings: Finding[] = [];
  // Sólo se exigen las notas de una versión que ya tiene su tag: son el cuerpo
  // de su release. La versión inicial de una app que nunca publicó (flotas
  // empezó en 0.1.0 sin notas) no tiene nada que contar.
  if (git.localTagExists(`v${version}`)) {
    findings.push(
      changelogSection(md, version) === null
        ? warn("changelog", `la ${version} ya salió y no tiene notas en "## [${version}]"`)
        : ok("changelog", `CHANGELOG.md tiene las notas de la ${version}`),
    );
  } else {
    findings.push(ok("changelog", `CHANGELOG.md existe; la ${version} no tiene tag todavía`));
  }
  if (!/^##[ \t]+\[(?:Sin publicar|No publicado|Unreleased)\][ \t]*$/im.test(md)) {
    findings.push(
      warn(
        "changelog",
        'no hay una sección "## [Sin publicar]" donde ir anotando lo próximo',
        'agrega "## [Sin publicar]" arriba de la última versión',
      ),
    );
  }
  return findings;
}

function config(root: string): Finding[] {
  const { base, gate } = readConfig(root);
  if (gate === null) {
    return [
      error(
        "puerta",
        "no hay puerta: la app no usa Vite+ y no dice qué comandos tienen que pasar",
        '"star": { "gate": ["bun test"] } en package.json',
      ),
    ];
  }
  if (gate.length === 0) {
    return [warn("puerta", "la puerta está vacía: una versión sale sin correr nada")];
  }
  return [ok("puerta", `${gate.join(" && ")} (base ${base})`)];
}

function hooks(root: string, git: Git): Finding[] {
  const findings: Finding[] = [];
  const states = inspectHooks(root);
  const missing = states.filter((h) => h.state !== "same").map((h) => h.name);
  if (missing.length > 0) {
    findings.push(
      warn(
        "hooks",
        `${missing.join(" y ")} ${missing.length > 1 ? "faltan o no son" : "falta o no es"} el de star`,
        "bunx star init hooks",
      ),
    );
  }
  if (git.getConfig("core.hooksPath") !== HOOKS_DIR) {
    findings.push(
      warn(
        "hooks",
        `git no usa ${HOOKS_DIR} en este clon (core.hooksPath)`,
        "bunx star init hooks",
      ),
    );
  }
  // Pasó en flotas: los hooks llegaron al índice como 644 desde Windows, y en
  // Linux git los ignoraba sin que nadie lo notara.
  const paths = HOOK_NAMES.map((n) => `${HOOKS_DIR}/${n}`);
  const modes = git.indexModes(paths);
  const notExecutable = paths.filter((p) => modes[p] && modes[p] !== "100755");
  if (notExecutable.length > 0) {
    findings.push(
      error(
        "hooks",
        `${notExecutable.join(", ")} ${notExecutable.length > 1 ? "no son ejecutables" : "no es ejecutable"} en git: en Linux y macOS no corre${notExecutable.length > 1 ? "n" : ""}`,
        "bunx star init hooks",
      ),
    );
  }
  if (findings.length === 0) findings.push(ok("hooks", "commit-msg y pre-push instalados"));
  return findings;
}

/**
 * La tarea `release` de `vite.config.ts`, leída como texto: importar la config
 * ejecutaría código de la app solo para diagnosticarla.
 */
export function releaseTask(viteConfig: string): Finding {
  const match = /\brelease\s*:\s*(\{[^{}]*\}|"[^"]*"|'[^']*'|`[^`]*`)/.exec(viteConfig);
  if (!match) {
    return ok("vite+", "no hay tarea release: se corre `bunx star release` directo");
  }
  const value = match[1] ?? "";
  // Una tarea con caché corre sin TTY, y entonces release no tiene a quién
  // preguntar (probado con Vite+ 1.5.0).
  if (!value.startsWith("{") || !/\bcache\s*:\s*false\b/.test(value)) {
    return error(
      "vite+",
      "la tarea release tiene caché: corre sin terminal y no puede preguntar",
      'release: { command: "bunx star release", cache: false }',
    );
  }
  if (!/bunx star release/.test(value)) {
    return warn("vite+", "la tarea release no llama a `bunx star release`");
  }
  return ok("vite+", "la tarea release corre sin caché");
}

function vitePlus(root: string): Finding[] {
  const path = ["vite.config.ts", "vite.config.mts", "vite.config.js"]
    .map((f) => join(root, f))
    .find((p) => existsSync(p));
  return path ? [releaseTask(readFileSync(path, "utf8"))] : [];
}

/**
 * Un script que llama a `star` a secas. En Windows, el shim de Bun para un bin
 * con shebang `bun` busca `bun.exe`, y no está donde Bun se instaló con npm.
 */
function scripts(root: string): Finding[] {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8").replace(/^﻿/, "")) as {
    scripts?: Record<string, string>;
  };
  const bare = Object.entries(pkg.scripts ?? {})
    .filter(([, command]) => /(?:^|&&|\|\||;)\s*star\b/.test(command))
    .map(([name]) => name);
  return bare.length > 0
    ? [
        warn(
          "scripts",
          `${bare.join(", ")} llama a \`star\` sin bunx: en Windows puede no encontrarlo`,
          "cambia `star …` por `bunx star …`",
        ),
      ]
    : [];
}

function ci(root: string): Finding[] {
  const dir = join(root, ".github", "workflows");
  const texts = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => readFileSync(join(dir, f), "utf8"))
    : [];
  // Una app nueva todavía no tiene CI: se dice, porque sin ella los hooks son
  // la única barrera y se saltan con --no-verify.
  if (texts.length === 0) {
    return [
      warn(
        "ci",
        "no hay workflows en .github/workflows: nada revisa los PR",
        "un workflow que corra la puerta, bunx star lint commits y bunx star lint branch",
      ),
    ];
  }
  const findings: Finding[] = [];
  if (texts.some((t) => /\.githooks\/(?:commit-msg|pre-push)\b/.test(t))) {
    findings.push(
      warn(
        "ci",
        "un workflow corre los scripts de .githooks: con star, la regla de la CI es `star lint`",
        "usa `bunx star lint commits` y `bunx star lint branch`",
      ),
    );
  }
  findings.push(
    // `bunx star lint` en una app; `bun src/cli.ts lint` en el propio kit.
    texts.some((t) => /(?:\bstar|cli\.ts)\s+lint\b/.test(t))
      ? ok("ci", "la CI revisa commits y ramas con star lint")
      : warn(
          "ci",
          "la CI no revisa la convención: un hook se salta con --no-verify",
          "bunx star lint commits y bunx star lint branch en el workflow de los PR",
        ),
  );
  return findings;
}

function remote(git: Git, gh: Gh, root: string): Finding[] {
  const findings: Finding[] = [];
  if (git.getConfig("remote.origin.url") === null) {
    findings.push(warn("github", "no hay un remoto origin: release empuja ahí"));
  } else {
    const { base } = readConfig(root);
    if (git.remoteBranchExists(base) === false) {
      findings.push(error("github", `origin no tiene la rama ${base}, de donde sale cada versión`));
    }
  }
  findings.push(
    gh.available()
      ? ok("github", "gh tiene sesión")
      : warn(
          "github",
          "gh no está instalado o no tiene sesión: release no puede abrir ni mergear el PR",
          "gh auth login",
        ),
  );
  return findings;
}

/**
 * Llaves privadas commiteadas. Una llave que llegó a git ya se filtró: borrarla
 * en otro commit no la saca del historial, hay que rotarla.
 */
function secrets(git: Git): Finding[] {
  // PEM, y la llave del updater de Tauri (minisign). Los `[K]` y `[k]` no
  // cambian lo que calza, pero hacen que este archivo no calce consigo mismo.
  const files = git.trackedMatching(
    "-----BEGIN [A-Z ]*PRIVATE [K]EY-----|untrusted comment: .*secret [k]ey",
  );
  return files.length > 0
    ? [
        error(
          "secretos",
          `hay llaves privadas commiteadas: ${files.join(", ")}`,
          "rota la llave, sácala del repo y guárdala como secreto de GitHub",
        ),
      ]
    : [ok("secretos", "ninguna llave privada commiteada")];
}

export function diagnose({ root, git, gh }: DoctorDeps): Finding[] {
  // Todo lo demás lee el package.json: sin él no hay una app que revisar.
  if (!existsSync(join(root, "package.json"))) {
    return [error("app", "no hay un package.json acá: corre star desde la raíz de la app")];
  }
  return [
    ...guard("versión", () => manifests(root)),
    ...guard("changelog", () => changelog(root, git)),
    ...guard("puerta", () => config(root)),
    ...guard("hooks", () => hooks(root, git)),
    ...guard("vite+", () => vitePlus(root)),
    ...guard("scripts", () => scripts(root)),
    ...guard("ci", () => ci(root)),
    ...guard("github", () => remote(git, gh, root)),
    ...guard("secretos", () => secrets(git)),
  ];
}
