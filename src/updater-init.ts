import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";
import { findStringAt, replaceSpan } from "./json-text.ts";

/** El secreto que lee `tauri-release.yml`. */
export const PRIVATE_SECRET = "TAURI_SIGNING_PRIVATE_KEY";

const PUBKEY_PATH = ["plugins", "updater", "pubkey"] as const;

/**
 * Dónde queda el respaldo de la llave: fuera del repo, en la máquina de quien
 * la generó (decisión 17). GitHub no deja leer un secreto después de
 * guardarlo, así que si la llave sólo viviera ahí y se perdiera, ninguna app
 * instalada se podría volver a actualizar.
 */
export function keysDir(identifier: string, home = process.env.STAR_HOME): string {
  return join(home ?? join(homedir(), ".star"), "keys", identifier);
}

export type UpdaterState = {
  confPath: string;
  conf: string;
  identifier: string;
  /** La llave pública de `tauri.conf.json`; `null` si no hay, `""` si está vacía. */
  pubkey: string | null;
  createsArtifacts: boolean;
  /** Si el repo tiene el secreto; `null` si no se pudo preguntar. */
  secret: boolean | null;
  backup: { dir: string; key: string; pub: string; hasKey: boolean; pubText: string | null };
};

/** El estado del updater de una app de escritorio, o `null` si no es una app Tauri. */
export function inspectUpdater(root: string, gh: Pick<Gh, "secretNames">): UpdaterState | null {
  const confPath = join(root, "src-tauri", "tauri.conf.json");
  if (!existsSync(confPath)) return null;
  const conf = readFileSync(confPath, "utf8");
  const parsed = JSON.parse(conf.replace(/^﻿/, "")) as {
    identifier?: string;
    bundle?: { createUpdaterArtifacts?: unknown };
  };
  if (!parsed.identifier) {
    throw new StarError('src-tauri/tauri.conf.json no tiene "identifier": la app no tiene nombre.');
  }
  const dir = keysDir(parsed.identifier);
  const key = join(dir, "updater.key");
  const pub = join(dir, "updater.key.pub");
  const names = gh.secretNames();
  return {
    confPath,
    conf,
    identifier: parsed.identifier,
    pubkey: findStringAt(conf, PUBKEY_PATH)?.value ?? null,
    createsArtifacts: parsed.bundle?.createUpdaterArtifacts === true,
    secret: names === null ? null : names.includes(PRIVATE_SECRET),
    backup: {
      dir,
      key,
      pub,
      hasKey: existsSync(key),
      pubText: existsSync(pub) ? readFileSync(pub, "utf8").trim() : null,
    },
  };
}

export type UpdaterPlan =
  | { action: "ready"; warnings: string[] }
  | { action: "generate" }
  | { action: "upload" }
  | { action: "blocked"; reason: string };

/**
 * Qué hacer, sin hacerlo todavía.
 *
 * **Nunca se genera una llave para una app que ya tiene una.** La pública va
 * adentro de cada instalador que ya está dando vueltas: una llave nueva deja a
 * todos esos usuarios sin poder actualizarse nunca más.
 */
export function planUpdater(state: UpdaterState): UpdaterPlan {
  const { pubkey, backup, secret } = state;
  if (pubkey === null) {
    return {
      action: "blocked",
      reason:
        'tauri.conf.json no tiene "plugins.updater.pubkey". Agrega el bloque del updater (con "pubkey": "") y vuelve a correr esto:\n\n' +
        '  "plugins": {\n    "updater": {\n      "pubkey": "",\n      "endpoints": ["https://github.com/<dueño>/<repo>/releases/latest/download/latest.json"]\n    }\n  }',
    };
  }
  if (pubkey === "") {
    if (backup.hasKey) {
      return {
        action: "blocked",
        reason: `ya hay una llave en ${backup.dir}, pero tauri.conf.json no tiene la pública. ¿Es de otra copia de esta app? Revísalo a mano antes de generar otra.`,
      };
    }
    return { action: "generate" };
  }
  if (backup.pubText !== null && backup.pubText !== pubkey.trim()) {
    return {
      action: "blocked",
      reason: `la llave de ${backup.dir} no es la de tauri.conf.json. No se toca nada: con la llave equivocada, las apps instaladas rechazan cada actualización.`,
    };
  }
  if (secret === false) {
    if (backup.hasKey) return { action: "upload" };
    return {
      action: "blocked",
      reason: `el repo no tiene el secreto ${PRIVATE_SECRET} y no hay respaldo en ${backup.dir}. Si tienes la llave, impórtala: \`star init updater --import <ruta-de-la-llave>\`.`,
    };
  }
  const warnings: string[] = [];
  if (!backup.hasKey) {
    warnings.push(
      `no hay respaldo de la llave en ${backup.dir}. Si la tienes en otra parte, impórtala con \`star init updater --import <ruta>\`; si se pierde, las apps instaladas no se actualizan más.`,
    );
  }
  if (secret === null) warnings.push(`no se pudo revisar si el repo tiene ${PRIVATE_SECRET}.`);
  return { action: "ready", warnings };
}

/** Escribe la llave pública en `tauri.conf.json`, cambiando sólo esos caracteres. */
export function writePubkey(state: UpdaterState, pubkey: string): void {
  const span = findStringAt(state.conf, PUBKEY_PATH);
  if (!span) throw new StarError('tauri.conf.json no tiene "plugins.updater.pubkey".');
  writeFileSync(state.confPath, replaceSpan(state.conf, span, pubkey));
}

/**
 * Genera la llave con la CLI de Tauri, sin contraseña (decisión 17), directo
 * en la carpeta del respaldo. La salida se captura: con `-w` no trae la llave,
 * pero no hay por qué confiar en que siga así.
 */
export function generateKeyWithTauri(root: string, dir: string): void {
  // Sin la CLI local, `bunx tauri` buscaría en npm un paquete que se llama
  // "tauri" y no es este.
  if (!existsSync(join(root, "node_modules", "@tauri-apps", "cli"))) {
    throw new StarError("no está instalada la CLI de Tauri: `bun add -d @tauri-apps/cli`.");
  }
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(
    "bunx",
    ["tauri", "signer", "generate", "--ci", "-w", join(dir, "updater.key")],
    {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      env: { ...process.env, CI: "true" },
    },
  );
  if (r.status !== 0) {
    throw new StarError(
      "tauri signer generate falló. ¿Está instalada la CLI de Tauri (@tauri-apps/cli)?",
    );
  }
  protect(dir);
}

/** Sólo quien la generó puede leerla. En Windows el modo no aplica y no hace nada. */
function protect(dir: string) {
  for (const file of ["updater.key", "updater.key.pub"]) {
    const path = join(dir, file);
    if (existsSync(path)) chmodSync(path, 0o600);
  }
}

/**
 * Copia una llave que ya existía (Starless la tiene en `.secrets/`) al
 * respaldo. Sólo si su pública, al lado con `.pub`, es la de `tauri.conf.json`:
 * importar la llave de otra app sería peor que no tener respaldo.
 */
export function importKey(state: UpdaterState, source: string): void {
  const pubSource = `${source}.pub`;
  if (!existsSync(source) || !existsSync(pubSource)) {
    throw new StarError(`hace falta la llave y su pública al lado: ${source} y ${pubSource}.`);
  }
  const pub = readFileSync(pubSource, "utf8").trim();
  if (!state.pubkey || pub !== state.pubkey.trim()) {
    throw new StarError(
      `la pública de ${pubSource} no es la de tauri.conf.json: esa llave no es la de esta app.`,
    );
  }
  mkdirSync(state.backup.dir, { recursive: true });
  copyFileSync(source, state.backup.key);
  copyFileSync(pubSource, state.backup.pub);
  protect(state.backup.dir);
}

/** Sube la llave del respaldo como secreto del repo, sin que pase por la pantalla. */
export function uploadKey(state: UpdaterState, gh: Pick<Gh, "setSecret">): void {
  gh.setSecret(PRIVATE_SECRET, readFileSync(state.backup.key, "utf8"));
}
