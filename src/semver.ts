import { StarError } from "./errors.ts";

/** `major.minor.patch` con un prerelease opcional (`1.2.0-rc.1`). Sin metadatos de build. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export type Version = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
};

export type Level = "patch" | "minor" | "major";

/**
 * Qué significa cada nivel.
 *
 * **El kit no decide cuál corresponde.** Puede mover el número, pero si un
 * cambio sólo arregla, agrega o rompe es algo que se dice del producto, no del
 * diff. Por eso se pregunta.
 */
export const LEVELS: Record<Level, string> = {
  patch: "sólo arregla: no agrega nada ni rompe nada que ya funcionaba",
  minor: "agrega algo que no existía, sin romper lo que había",
  major: "rompe con lo anterior: algo deja de funcionar como antes",
};

export function isLevel(value: unknown): value is Level {
  return value === "patch" || value === "minor" || value === "major";
}

/** Lee una versión o explica de dónde salió la que no sirve. */
export function parseVersion(raw: string, source: string): Version {
  const m = SEMVER.exec(raw.trim());
  if (!m) {
    throw new StarError(`${source} dice "${raw}", que no es una versión major.minor.patch.`);
  }
  const version: Version = { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
  if (m[4] !== undefined) version.prerelease = m[4];
  return version;
}

export function formatVersion(v: Version): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease ? `${base}-${v.prerelease}` : base;
}

/**
 * La versión siguiente.
 *
 * Desde un prerelease se sigue la regla de SemVer (la misma de `npm version`):
 * `1.2.0-rc.1` con `minor` es `1.2.0`, porque el prerelease ya era el anticipo
 * de esa versión. Subir a `1.3.0` saltaría una versión que nunca salió.
 */
export function bump(v: Version, level: Level): Version {
  const pre = v.prerelease !== undefined;
  if (level === "major") {
    if (pre && v.minor === 0 && v.patch === 0) return { major: v.major, minor: 0, patch: 0 };
    return { major: v.major + 1, minor: 0, patch: 0 };
  }
  if (level === "minor") {
    if (pre && v.patch === 0) return { major: v.major, minor: v.minor, patch: 0 };
    return { major: v.major, minor: v.minor + 1, patch: 0 };
  }
  if (pre) return { major: v.major, minor: v.minor, patch: v.patch };
  return { major: v.major, minor: v.minor, patch: v.patch + 1 };
}
