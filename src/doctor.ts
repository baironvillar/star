import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changelogSection, readChangelog } from "./changelog.ts";
import { readConfig } from "./config.ts";
import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";
import type { Git } from "./git.ts";
import { HOOK_NAMES, HOOKS_DIR, inspectHooks } from "./hooks.ts";
import { STAR } from "./command.ts";
import { mergeChanges } from "./merge-settings.ts";
import { MAIN } from "./release.ts";
import { inspectUpdater, planUpdater, PRIVATE_SECRET } from "./updater-init.ts";
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
        `${STAR} init changelog`,
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
        `${STAR} init hooks`,
      ),
    );
  }
  if (git.getConfig("core.hooksPath") !== HOOKS_DIR) {
    findings.push(
      warn("hooks", `git no usa ${HOOKS_DIR} en este clon (core.hooksPath)`, `${STAR} init hooks`),
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
        `${STAR} init hooks`,
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
    return ok("vite+", `no hay tarea release: se corre \`${STAR} release\` directo`);
  }
  const value = match[1] ?? "";
  // Una tarea con caché corre sin TTY, y entonces release no tiene a quién
  // preguntar (probado con Vite+ 1.5.0).
  if (!value.startsWith("{") || !/\bcache\s*:\s*false\b/.test(value)) {
    return error(
      "vite+",
      "la tarea release tiene caché: corre sin terminal y no puede preguntar",
      `release: { command: "${STAR} release", cache: false }`,
    );
  }
  if (!value.includes(`${STAR} release`)) {
    return warn(
      "vite+",
      "la tarea release no llama a star por su ruta: con `bunx star`, sin bun install corre otro paquete de npm",
      `release: { command: "${STAR} release", cache: false }`,
    );
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
 * Un script que llama a star sin su ruta (decisión 21). `star` a secas no se
 * encuentra en Windows: el shim de Bun para un bin con shebang `bun` busca
 * `bun.exe`, y no está donde Bun se instaló con npm. `bunx star`, sin el paquete
 * instalado, baja de npm otro paquete que se llama `star` y lo ejecuta.
 */
function scripts(root: string): Finding[] {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8").replace(/^﻿/, "")) as {
    scripts?: Record<string, string>;
  };
  const bare = Object.entries(pkg.scripts ?? {})
    .filter(([, command]) => /(?:^|&&|\|\||;)\s*(?:bunx\s+)?star\b/.test(command))
    .map(([name]) => name);
  return bare.length > 0
    ? [
        warn(
          "scripts",
          `${bare.join(", ")} no llama a star por su ruta: con \`bunx star\`, sin bun install corre otro paquete de npm`,
          `usa \`${STAR} …\``,
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
        "un workflow que corra la puerta y bunx star lint commits, branch y title",
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
  // Con los ajustes que pide star, el título del PR es el asunto del commit
  // que llega a la base. Un título fuera de la convención no lo frena ningún
  // hook: se escribe en GitHub.
  if (!texts.some((t) => /(?:\bstar|cli\.ts)\s+lint\s+title\b/.test(t))) {
    findings.push(
      warn(
        "ci",
        "la CI no revisa el título del PR, que es el asunto del squash",
        `${STAR} init github`,
      ),
    );
  }
  findings.push(...workflowVersions(root, texts));
  return findings;
}

/** Las versiones de los workflows de star que usa la app: `…/verify.yml@v0.3.0` → `0.3.0`. */
export function starWorkflowRefs(text: string): string[] {
  // Sólo las líneas `uses:`: un comentario con el ejemplo no es un uso.
  const refs = text.matchAll(
    /^\s*uses:\s*baironvillar\/star\/\.github\/workflows\/[\w.-]+@v(\S+)/gm,
  );
  return [...new Set([...refs].map((m) => m[1] ?? ""))];
}

/**
 * Los workflows de star corren el star instalado en la app. Si el workflow es
 * de otra versión, puede llamar a un comando que esa versión no tiene.
 */
function workflowVersions(root: string, texts: string[]): Finding[] {
  const refs = [...new Set(texts.flatMap(starWorkflowRefs))];
  if (refs.length === 0) return [];
  const installed = join(root, "node_modules", "@baironvillar", "star", "package.json");
  if (!existsSync(installed)) {
    return [warn("ci", "los workflows usan star, pero no está instalado", "bun install")];
  }
  const { version } = JSON.parse(readFileSync(installed, "utf8")) as { version: string };
  const other = refs.filter((r) => r !== version);
  return other.length > 0
    ? [
        warn(
          "ci",
          `los workflows de star van en v${other.join(", v")} y la app tiene instalada la ${version}`,
          `usa @v${version} en los workflows, o instala esa versión`,
        ),
      ]
    : [ok("ci", `los workflows de star van en la misma versión instalada (${version})`)];
}

function remote(git: Git, gh: Gh, root: string): Finding[] {
  const findings: Finding[] = [];
  if (git.getConfig("remote.origin.url") === null) {
    findings.push(warn("github", "no hay un remoto origin: release empuja ahí"));
  } else {
    const { base } = readConfig(root);
    if (git.remoteBranchExists(base) === false) {
      findings.push(
        error(
          "github",
          `origin no tiene la rama ${base}, de donde sale cada versión`,
          `${STAR} init github`,
        ),
      );
    }
    if (git.remoteBranchExists(MAIN) === false) {
      findings.push(
        error("github", `origin no tiene ${MAIN}, donde llega cada versión`, `${STAR} init github`),
      );
    }
  }
  if (!gh.available()) {
    findings.push(
      warn(
        "github",
        "gh no está instalado o no tiene sesión: release no puede abrir ni mergear el PR",
        "gh auth login",
      ),
    );
    return findings;
  }
  findings.push(ok("github", "gh tiene sesión"));
  if (git.getConfig("remote.origin.url") !== null) {
    findings.push(...mergeSettings(gh, readConfig(root).base));
  }
  if (!existsSync(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"))) {
    findings.push(
      warn(
        "github",
        "no hay plantilla de PR: la descripción es el cuerpo del commit en la base",
        `${STAR} init github`,
      ),
    );
  }
  return findings;
}

/**
 * Los ajustes de merge del repo (decisiones 18 y 19): sólo squash, desde el
 * título y la descripción del PR, y la base como rama por defecto.
 */
function mergeSettings(gh: Gh, base: string): Finding[] {
  const settings = gh.mergeSettings();
  if (!settings) {
    return [
      warn(
        "github",
        "no se pudieron leer los ajustes de merge del repo (sin permiso de escritura GitHub no los muestra)",
      ),
    ];
  }
  const changes = mergeChanges(settings, base);
  if (changes.length === 0) {
    return [
      ok("github", `sólo squash, desde el título y la descripción del PR, y ${base} por defecto`),
    ];
  }
  return [
    warn(
      "github",
      `el repo no está como lo pide star: ${changes.map((c) => c.description).join("; ")}`,
      `${STAR} init github`,
    ),
  ];
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

/**
 * El updater de una app de escritorio. Se salta en una app web. De los
 * secretos de GitHub se mira sólo el nombre: el valor no se puede leer, y no
 * habría por qué.
 */
function updater(root: string, gh: Gh): Finding[] {
  const state = inspectUpdater(root, gh);
  if (!state) return [];
  const findings: Finding[] = [];
  if (!state.createsArtifacts) {
    findings.push(
      error(
        "updater",
        '"bundle.createUpdaterArtifacts" no es true: la release sale sin .sig ni latest.json',
        'agrega "createUpdaterArtifacts": true en "bundle" de tauri.conf.json',
      ),
    );
  }
  const plan = planUpdater(state);
  switch (plan.action) {
    case "blocked":
      findings.push(error("updater", plan.reason));
      break;
    case "generate":
      findings.push(error("updater", "la app no tiene llave del updater", `${STAR} init updater`));
      break;
    case "upload":
      findings.push(
        error("updater", `el repo no tiene el secreto ${PRIVATE_SECRET}`, `${STAR} init updater`),
      );
      break;
    case "ready":
      for (const w of plan.warnings) findings.push(warn("updater", w));
      if (plan.warnings.length === 0) {
        findings.push(ok("updater", `llave pública, ${PRIVATE_SECRET} y respaldo en orden`));
      }
  }
  return findings;
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
    ...guard("updater", () => updater(root, gh)),
    ...guard("secretos", () => secrets(git)),
  ];
}
