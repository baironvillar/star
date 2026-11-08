import { StarError } from "../errors.ts";
import { findTopLevelString, replaceSpan } from "../json-text.ts";
import type { VersionState } from "./types.ts";

/** `package.json`: el campo `version` de primer nivel. */
export const packageJson = {
  read(text: string): VersionState {
    const span = findTopLevelString(text, "version");
    if (!span) throw new StarError('no tiene un campo "version".');
    return { version: span.value };
  },
  write(text: string, version: string): string {
    const span = findTopLevelString(text, "version");
    if (!span) throw new StarError('no tiene un campo "version" que reescribir.');
    return replaceSpan(text, span, version);
  },
};

/**
 * `tauri.conf.json`: el campo `version`, que puede no ser un número.
 *
 * Tauri 2 acepta una ruta a un `package.json` en lugar de la versión
 * (`"version": "../package.json"`), y si el campo no está usa la de
 * `Cargo.toml`. En los dos casos el archivo no tiene copia propia y no se
 * escribe: es una fuente menos que se puede desincronizar.
 */
export const tauriConf = {
  read(text: string): VersionState {
    const span = findTopLevelString(text, "version");
    if (!span) return { linkedTo: "Cargo.toml" };
    if (span.value.endsWith(".json")) return { linkedTo: span.value };
    return { version: span.value };
  },
  write(text: string, version: string): string {
    const span = findTopLevelString(text, "version");
    if (!span || span.value.endsWith(".json")) {
      throw new StarError("no tiene versión propia: la toma de otro archivo.");
    }
    return replaceSpan(text, span, version);
  },
};
