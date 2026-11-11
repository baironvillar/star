import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkMessage, subjectOf, type Verdict } from "./conventions.ts";
import type { Git } from "./git.ts";

export const HOOK_NAMES = ["commit-msg", "pre-push"] as const;
export type HookName = (typeof HOOK_NAMES)[number];

/** La carpeta de hooks de la app, la que se commitea y apunta `core.hooksPath`. */
export const HOOKS_DIR = ".githooks";

/**
 * Lo que queda en la app: una línea que llama a star.
 *
 * La regla vive en el paquete y no en una copia: así una corrección llega a
 * todas las apps con subir la versión de star, y la CI (`star lint`) corre el
 * mismo código que el hook. `sh` porque git corre los hooks con el intérprete
 * del shebang en cualquier plataforma, también en Windows (con el de Git).
 * `exec` le deja el stdin a star: `pre-push` recibe las refs por ahí.
 */
export function hookScript(name: HookName): string {
  return [
    "#!/usr/bin/env sh",
    "#",
    "# Instalado por `star init hooks`. La convención vive en star, no acá: este",
    "# archivo no se edita, y la CI corre la misma regla con `star lint`.",
    `exec bunx star hook ${name} "$@"`,
    "",
  ].join("\n");
}

export type HookState = { name: HookName; path: string; state: "missing" | "same" | "different" };

export function inspectHooks(root: string): HookState[] {
  return HOOK_NAMES.map((name) => {
    const path = join(root, HOOKS_DIR, name);
    if (!existsSync(path)) return { name, path, state: "missing" };
    // Un checkout en Windows con autocrlf puede traer CRLF: es el mismo archivo.
    const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    return { name, path, state: text === hookScript(name) ? "same" : "different" };
  });
}

/**
 * Escribe los hooks que faltan o difieren y apunta git a la carpeta.
 *
 * Se ponen en el stage como ejecutables porque Windows no guarda el bit: sin
 * eso llegan al índice como 644, y en un clon de Linux o macOS git los ignora
 * con un aviso que nadie lee. También los que ya estaban al día: un hook con
 * el contenido correcto pero 644 en el índice no corre en Linux.
 *
 * En Windows, además, apaga `core.filemode` si está prendido. El disco no
 * guarda el bit, así que git ve cada hook "cambiado" a 644, y el siguiente
 * `git add -A` deshace el `--chmod`. Pasó al adoptarlo en flotas.
 *
 * Devuelve si tuvo que apagar `core.filemode`.
 */
export function installHooks(
  root: string,
  git: Git,
  hooks: HookState[],
  platform: string = process.platform,
): { fileModeOff: boolean } {
  mkdirSync(join(root, HOOKS_DIR), { recursive: true });
  for (const hook of hooks) {
    if (hook.state === "same") continue;
    writeFileSync(hook.path, hookScript(hook.name));
    chmodSync(hook.path, 0o755);
  }
  const fileModeOff = platform === "win32" && git.getConfig("core.filemode") === "true";
  if (fileModeOff) git.setConfig("core.filemode", "false");
  git.addExecutable(hooks.map((h) => `${HOOKS_DIR}/${h.name}`));
  if (git.getConfig("core.hooksPath") !== HOOKS_DIR) git.setConfig("core.hooksPath", HOOKS_DIR);
  return { fileModeOff };
}

export type CommitResult = {
  sha: string;
  subject: string;
  verdict: Verdict;
  /** Un commit viejo que la app anotó en `star.lint.skip`: no se revisa. */
  skipped?: boolean;
};

/**
 * Lo que una app que ya existía le pide al lint: no revisar la historia de
 * antes de adoptar la convención (decisión 14).
 */
export type LintHistory = {
  /** El commit desde el que rige la regla: ni él ni sus ancestros se revisan. */
  since?: string;
  /** Commits sueltos que ya estaban y no se pueden reescribir. */
  skip?: string[];
};

/**
 * Los commits nuevos de un push o de un PR, revisados.
 *
 * `base..head`, o un solo commit. La primera vez que se empuja una rama el
 * `base` viene en ceros, y después de un force-push puede no estar en el clon:
 * en los dos casos se mira sólo la punta, que es lo único que se sabe nuevo. Si
 * la app dice desde dónde rige la regla (`since`), se mira desde ahí.
 *
 * Un PR de `develop` a `main` arrastra toda la historia que `main` no tiene, y
 * en una app que adoptó la convención con historia escrita esa historia no la
 * cumple: sin `since` y `skip`, ese PR no podría pasar nunca (le pasó a
 * Starless).
 */
export function lintCommits(
  git: Git,
  spec: string,
  history: LintHistory = {},
): { onlyTip: boolean; results: CommitResult[] } {
  const [base, head] = spec.includes("..") ? spec.split("..", 2) : [undefined, spec];
  const tip = head || "HEAD";
  const known = Boolean(base) && !/^0+$/.test(base ?? "") && git.commitMessage(base ?? "") !== null;
  const { since, skip = [] } = history;
  let shas: string[];
  if (known && base) shas = git.commitsBetween(base, tip, since);
  else if (since) shas = git.commitsBetween(since, tip);
  else shas = [tip];
  const results = shas.map((sha): CommitResult => {
    if (skip.some((s) => s.length >= 7 && sha.startsWith(s))) {
      return {
        sha,
        subject: subjectOf(git.commitMessage(sha) ?? ""),
        verdict: { ok: true },
        skipped: true,
      };
    }
    const message = git.commitMessage(sha);
    if (message === null) {
      return { sha, subject: "", verdict: { ok: false, reason: `${sha} no está en este clon` } };
    }
    return { sha, subject: subjectOf(message), verdict: checkMessage(message) };
  });
  return { onlyTip: base !== undefined && !known && !since, results };
}
