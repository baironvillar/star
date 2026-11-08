import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StarError } from "./errors.ts";

export type Config = {
  /** La rama de integración: de donde sale una versión y adonde vuelve. */
  base: string;
  /** Los comandos que tienen que pasar antes de publicar, o `null` si no hay forma de saberlos. */
  gate: string[] | null;
};

type PackageJson = {
  star?: { base?: unknown; gate?: unknown };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * La configuración de la app, en la clave `"star"` de su `package.json`.
 *
 * Va ahí y no en `vite.config.ts` porque Vite+ valida sus propias claves, y
 * porque una app sin Vite+ (Starless lintea con Biome) también tiene que poder
 * configurar su puerta.
 *
 * Sin configuración: la base es `develop`, y si la app usa Vite+ la puerta es
 * `vp check` y `vp test run`. Si no lo usa, no hay una puerta que adivinar.
 */
export function readConfig(root: string): Config {
  const pkg = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8").replace(/^﻿/, ""),
  ) as PackageJson;
  const star = pkg.star ?? {};

  if (star.base !== undefined && typeof star.base !== "string") {
    throw new StarError('"star.base" en package.json tiene que ser el nombre de una rama.');
  }

  let gate: string[] | null;
  if (star.gate === undefined) {
    const usesVitePlus = Boolean(
      pkg.devDependencies?.["vite-plus"] ?? pkg.dependencies?.["vite-plus"],
    );
    gate = usesVitePlus ? ["vp check", "vp test run"] : null;
  } else if (typeof star.gate === "string") {
    gate = [star.gate];
  } else if (Array.isArray(star.gate) && star.gate.every((c) => typeof c === "string")) {
    gate = star.gate as string[];
  } else {
    throw new StarError(
      '"star.gate" en package.json tiene que ser un comando o una lista de comandos.',
    );
  }

  return { base: star.base ?? "develop", gate };
}
