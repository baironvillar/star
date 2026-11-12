import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StarError } from "./errors.ts";

export type Config = {
  /** La rama de integración: de donde sale una versión y adonde vuelve. */
  base: string;
  /** Los comandos que tienen que pasar antes de publicar, o `null` si no hay forma de saberlos. */
  gate: string[] | null;
  /** La historia que `star lint commits` no revisa. */
  lint: { since?: string; skip: string[] };
  /**
   * Si `star release` espera el CI del PR y lo termina solo (merge, main y
   * tag), en vez de dejarlo para `star release finish`.
   */
  autoMerge: boolean;
  /**
   * Si se pregunta antes de lanzar una versión que llegó sola a la base: el
   * merge a `main` y el tag. Con `false` y `autoMerge`, es 100% automático.
   */
  confirmRelease: boolean;
};

type PackageJson = {
  star?: {
    base?: unknown;
    gate?: unknown;
    lint?: { since?: unknown; skip?: unknown };
    autoMerge?: unknown;
    confirmRelease?: unknown;
  };
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
 * Sin configuración: la base es `develop`, nada se mergea solo, se pregunta
 * antes de lanzar, y si la app usa Vite+ la puerta es
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

  const lint = star.lint ?? {};
  if (lint.since !== undefined && typeof lint.since !== "string") {
    throw new StarError('"star.lint.since" en package.json tiene que ser un commit.');
  }
  if (
    lint.skip !== undefined &&
    !(Array.isArray(lint.skip) && lint.skip.every((s) => typeof s === "string"))
  ) {
    throw new StarError('"star.lint.skip" en package.json tiene que ser una lista de commits.');
  }

  if (star.autoMerge !== undefined && typeof star.autoMerge !== "boolean") {
    throw new StarError('"star.autoMerge" en package.json tiene que ser true o false.');
  }
  if (star.confirmRelease !== undefined && typeof star.confirmRelease !== "boolean") {
    throw new StarError('"star.confirmRelease" en package.json tiene que ser true o false.');
  }

  return {
    base: star.base ?? "develop",
    gate,
    lint: { since: lint.since, skip: (lint.skip as string[] | undefined) ?? [] },
    autoMerge: star.autoMerge ?? false,
    confirmRelease: star.confirmRelease ?? true,
  };
}
