import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StarError } from "./errors.ts";

/** La plantilla, dentro del paquete instalado (o del repo de star). */
export const TEMPLATE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
  "relay",
);

/** Los archivos que se copian, relativos a la plantilla y a `relay/` en la app. */
export const RELAY_FILES = [
  "README.md",
  "wrangler.toml",
  "tsconfig.json",
  "src/index.ts",
  "src/report.ts",
  "src/index.test.ts",
  "src/report.test.ts",
] as const;

/**
 * `owner/repo` desde la URL de `origin`, HTTPS o SSH. `null` si no es GitHub.
 */
export function githubRepo(url: string | null): string | null {
  if (!url) return null;
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * El nombre corto de la app, para el Worker y las marcas: el `productName` de
 * Tauri o el `name` del package.json, en minúscula y kebab-case.
 */
export function appName(root: string): string {
  const tauri = join(root, "src-tauri", "tauri.conf.json");
  const read = (path: string) =>
    JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as {
      productName?: string;
      name?: string;
    };
  const raw =
    (existsSync(tauri) ? read(tauri).productName : undefined) ??
    read(join(root, "package.json")).name ??
    "";
  const name = raw
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!name) throw new StarError("no se pudo sacar un nombre para el relay: usa --name.");
  return name;
}

export function render(text: string, values: { app: string; repo: string }): string {
  return text.replaceAll("{{app}}", values.app).replaceAll("{{repo}}", values.repo);
}

/**
 * Copia la plantilla a `relay/` en la app.
 *
 * **No pisa un relay que ya existe** (decisión 14): Starless tiene el suyo, con
 * el id de su almacenamiento ya commiteado. Si la carpeta está, no se escribe
 * nada.
 */
export function installRelay(root: string, values: { app: string; repo: string }): string[] {
  const target = join(root, "relay");
  if (existsSync(target)) {
    throw new StarError(
      "ya hay una carpeta relay/ en la app. No se toca: compárala a mano con la plantilla de star.",
    );
  }
  const written: string[] = [];
  for (const file of RELAY_FILES) {
    const destination = join(target, file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, render(readFileSync(join(TEMPLATE_DIR, file), "utf8"), values));
    written.push(`relay/${file}`);
  }
  return written;
}
