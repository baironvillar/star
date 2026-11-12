import { readFileSync, writeFileSync } from "node:fs";
import { StarError } from "./errors.ts";
import { discoverManifests } from "./manifests/discover.ts";
import { hasOwnVersion, type Manifest, type VersionState } from "./manifests/types.ts";
import { formatVersion, parseVersion } from "./semver.ts";

export type Entry = { manifest: Manifest; text: string; state: VersionState };

/** Cada manifiesto con lo que dice. Un archivo que no se puede leer es un error con su nombre. */
export function inspect(root: string): Entry[] {
  return discoverManifests(root).map((manifest) => {
    const text = readFileSync(manifest.path, "utf8");
    try {
      return { manifest, text, state: manifest.read(text) };
    } catch (error) {
      if (error instanceof StarError) throw new StarError(`${manifest.label} ${error.message}`);
      throw error;
    }
  });
}

/** La versión de la app: la del `package.json` raíz, que es el primero. */
export function currentVersion(entries: Entry[]): string {
  const root = entries[0];
  if (!root || !hasOwnVersion(root.state)) {
    throw new StarError('el package.json raíz no tiene un campo "version".');
  }
  return formatVersion(parseVersion(root.state.version, root.manifest.label));
}

/** Los manifiestos con copia propia que dicen otra cosa. */
export function disagreements(entries: Entry[], version: string): Entry[] {
  return entries.filter((e) => hasOwnVersion(e.state) && e.state.version !== version);
}

export type Change = { manifest: Manifest; before: string; after: string };

/**
 * Los textos nuevos de todos los manifiestos, sin escribir ninguno.
 *
 * **Se arma todo antes de tocar el disco.** Si un archivo no se puede
 * reescribir, no se escribió ninguno: un bump a medias deja exactamente el
 * desacuerdo que esto existe para evitar. Y cada texto nuevo se vuelve a leer
 * para confirmar que dice la versión pedida.
 */
export function planWrite(entries: Entry[], next: string): Change[] {
  const changes: Change[] = [];
  for (const { manifest, text, state } of entries) {
    if (!hasOwnVersion(state)) continue;
    let after: string;
    try {
      after = manifest.write(text, next);
      const reread = manifest.read(after);
      if (!hasOwnVersion(reread) || reread.version !== next) {
        throw new StarError(`después de escribir no dice ${next}.`);
      }
    } catch (error) {
      if (error instanceof StarError) throw new StarError(`${manifest.label} ${error.message}`);
      throw error;
    }
    if (after !== text) changes.push({ manifest, before: text, after });
  }
  return changes;
}

export function applyChanges(changes: Change[]): void {
  for (const change of changes) writeFileSync(change.manifest.path, change.after, "utf8");
}
