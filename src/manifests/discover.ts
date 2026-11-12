import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { StarError } from "../errors.ts";
import { cargoLock, cargoPackageName, cargoToml } from "./cargo.ts";
import { packageJson, tauriConf } from "./json.ts";
import type { Manifest } from "./types.ts";

/**
 * Todos los archivos de la app que llevan la versión.
 *
 * Se detectan, no se configuran: el `package.json` raíz siempre; el de cada
 * workspace; y por cada carpeta (la raíz o un workspace) que tenga `src-tauri/`,
 * su `tauri.conf.json`, su `Cargo.toml` y el `Cargo.lock` que corresponda.
 *
 * El primero de la lista es el `package.json` raíz: ahí vive la versión.
 */
export function discoverManifests(root: string): Manifest[] {
  const rootPackage = join(root, "package.json");
  if (!existsSync(rootPackage)) {
    throw new StarError(`no hay un package.json en ${root}. Corre star desde la raíz de la app.`);
  }

  const manifests: Manifest[] = [make(root, rootPackage, packageJson)];
  const workspaceDirs = workspaces(root, readFileSync(rootPackage, "utf8"));

  for (const dir of workspaceDirs) {
    manifests.push(make(root, join(dir, "package.json"), packageJson));
  }

  for (const dir of [root, ...workspaceDirs]) {
    manifests.push(...tauriManifests(root, dir));
  }

  return manifests;
}

function make(root: string, path: string, adapter: Pick<Manifest, "read" | "write">): Manifest {
  return {
    path,
    label: relative(root, path).replaceAll("\\", "/"),
    read: adapter.read,
    write: adapter.write,
  };
}

function tauriManifests(root: string, dir: string): Manifest[] {
  const tauriDir = join(dir, "src-tauri");
  const found: Manifest[] = [];
  const conf = join(tauriDir, "tauri.conf.json");
  if (existsSync(conf)) found.push(make(root, conf, tauriConf));

  const cargo = join(tauriDir, "Cargo.toml");
  if (!existsSync(cargo)) return found;
  found.push(make(root, cargo, cargoToml));

  // El lock está al lado del Cargo.toml, o en la raíz si src-tauri es parte de
  // un workspace de Cargo. Si no está en ninguno de los dos, no se commitea.
  const lock = [join(tauriDir, "Cargo.lock"), join(root, "Cargo.lock")].find((p) => existsSync(p));
  if (lock) {
    const name = cargoPackageName(readFileSync(cargo, "utf8"));
    found.push(make(root, lock, cargoLock(name)));
  }
  return found;
}

/**
 * Las carpetas de los workspaces, de los patrones del `package.json` raíz.
 *
 * Sólo se aceptan los patrones que usan las apps: una ruta literal
 * (`packages/db`) o una carpeta con `/*` al final (`apps/*`). Un patrón más
 * rebuscado falla con un mensaje en vez de dejar un workspace fuera sin avisar,
 * que sería un manifiesto con otra versión que nadie revisa.
 */
export function workspaces(root: string, packageText: string): string[] {
  const parsed = JSON.parse(packageText.replace(/^﻿/, "")) as {
    workspaces?: string[] | { packages?: string[] };
  };
  const patterns = Array.isArray(parsed.workspaces)
    ? parsed.workspaces
    : (parsed.workspaces?.packages ?? []);

  const dirs = new Set<string>();
  for (const pattern of patterns) {
    const clean = pattern.replace(/\/+$/, "");
    if (/[*?{}[\]!]/.test(clean.replace(/\/\*$/, ""))) {
      throw new StarError(
        `el patrón de workspaces "${pattern}" no está soportado. Usa rutas literales o "carpeta/*".`,
      );
    }
    if (clean.endsWith("/*")) {
      const base = join(root, clean.slice(0, -2));
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base).sort()) {
        const dir = join(base, entry);
        if (statSync(dir).isDirectory() && existsSync(join(dir, "package.json"))) dirs.add(dir);
      }
    } else {
      const dir = join(root, clean);
      if (existsSync(join(dir, "package.json"))) dirs.add(dir);
    }
  }
  return [...dirs];
}
