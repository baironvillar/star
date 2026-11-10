/**
 * La revisión de una release de escritorio antes de publicarla: que el
 * `latest.json` que va a leer la app instalada sirva.
 *
 * Se llevó desde `scripts/releases.ts check` de Starless, que existía porque
 * cada una de estas cosas falló alguna vez en una release publicada: un
 * manifest apuntando a un archivo que ya no estaba, una clave de plataforma que
 * faltaba, notas que no eran las del changelog.
 */

import { StarError } from "./errors.ts";
import type { Gh } from "./gh.ts";

export type ReleaseAsset = { id: number; name: string };

export type UpdaterManifest = {
  version?: string;
  notes?: string;
  platforms?: Record<string, { url?: string; signature?: string }>;
};

/** Las plataformas que el kit publica. macOS todavía no (ver el README). */
export const DESKTOP_PLATFORMS = ["windows", "linux"] as const;
export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number];

/**
 * La clave que tiene que tener `latest.json` para una plataforma.
 *
 * tauri-action escribe además una por instalador (`windows-x86_64-msi`), y el
 * plugin del updater la prueba primero. La genérica es la que no puede faltar:
 * es donde el plugin termina buscando.
 */
export function requiredKeys(platform: DesktopPlatform): string[] {
  return platform === "windows" ? ["windows-x86_64"] : ["linux-x86_64"];
}

/** Lo que se compara de dos textos de notas: sin espacios de más ni CRLF. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * El asset al que apunta una URL de `latest.json`.
 *
 * tauri-action v1 escribe `…/releases/download/<tag>/<nombre>`; las versiones
 * anteriores escribían `…/releases/assets/<id>`. Se aceptan las dos, para que
 * una app que ya tenía releases no vea errores en las viejas.
 */
export function assetForUrl(
  url: string,
  tag: string,
  assets: ReleaseAsset[],
): ReleaseAsset | undefined {
  const byId = /\/releases\/assets\/(\d+)(?:$|[?#])/.exec(url);
  if (byId) return assets.find((a) => a.id === Number(byId[1]));
  const prefix = `/releases/download/${tag}/`;
  const at = url.indexOf(prefix);
  if (at === -1) return undefined;
  const name = decodeURIComponent(url.slice(at + prefix.length));
  return assets.find((a) => a.name === name);
}

export type ReleaseCheckInput = {
  tag: string;
  notes: string;
  platforms: readonly DesktopPlatform[];
  assets: ReleaseAsset[];
  manifest: UpdaterManifest | null;
  /** El contenido de cada `.sig` de la release, por nombre del asset. */
  signatures: Record<string, string>;
};

/** Los problemas de la release, vacío si se puede publicar. */
export function checkDesktopRelease(input: ReleaseCheckInput): string[] {
  const { tag, manifest, assets } = input;
  const version = tag.replace(/^v/, "");
  if (!manifest) return ["la release no tiene latest.json: la app instalada no se va a enterar"];

  const problems: string[] = [];
  if (manifest.version?.replace(/^v/, "") !== version) {
    problems.push(`latest.json dice la versión ${manifest.version ?? "(nada)"}, no ${version}`);
  }
  if (normalize(manifest.notes ?? "") !== normalize(input.notes)) {
    problems.push("las notas de latest.json no son las del CHANGELOG");
  }

  for (const platform of input.platforms) {
    for (const key of requiredKeys(platform)) {
      if (!manifest.platforms?.[key]) problems.push(`latest.json no tiene la clave ${key}`);
    }
  }

  for (const [key, entry] of Object.entries(manifest.platforms ?? {})) {
    const asset = entry.url ? assetForUrl(entry.url, tag, assets) : undefined;
    if (!asset) {
      problems.push(
        `${key} apunta a un archivo que no está en la release: ${entry.url ?? "(nada)"}`,
      );
      continue;
    }
    // La firma del manifest es la que verifica la app. Si no es la del `.sig`
    // del mismo instalador, la app descarga y rechaza la actualización.
    const expected = input.signatures[`${asset.name}.sig`];
    if (expected === undefined) {
      problems.push(`${key}: falta ${asset.name}.sig en la release`);
    } else if (normalize(expected) !== normalize(entry.signature ?? "")) {
      problems.push(`${key}: la firma de latest.json no es la de ${asset.name}.sig`);
    }
  }
  return problems;
}

/**
 * Junta lo que hay en la release (assets, `latest.json`, las firmas) y lo
 * revisa. Es lo que corre el último job de `tauri-release.yml`.
 */
export function checkPublishedFiles(
  gh: Pick<Gh, "releaseAssets" | "downloadAsset">,
  input: { tag: string; notes: string; platforms: readonly DesktopPlatform[] },
): string[] {
  const assets = gh.releaseAssets(input.tag);
  const raw = assets.some((a) => a.name === "latest.json")
    ? gh.downloadAsset(input.tag, "latest.json")
    : null;
  let manifest: UpdaterManifest | null = null;
  if (raw !== null) {
    try {
      manifest = JSON.parse(raw) as UpdaterManifest;
    } catch {
      return ["latest.json no es JSON válido"];
    }
  }
  const signatures: Record<string, string> = {};
  for (const asset of assets.filter((a) => a.name.endsWith(".sig"))) {
    const text = gh.downloadAsset(input.tag, asset.name);
    if (text !== null) signatures[asset.name] = text;
  }
  return checkDesktopRelease({ ...input, assets, manifest, signatures });
}

/** `windows,linux` → las plataformas, o un error si alguna no la publica el kit. */
export function parsePlatforms(raw: string): DesktopPlatform[] {
  const names = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  for (const name of names) {
    if (name === "macos") {
      throw new StarError("macOS todavía no está en el kit: firmar y notarizar va en la fase 3.");
    }
    if (!(DESKTOP_PLATFORMS as readonly string[]).includes(name)) {
      throw new StarError(`"${name}" no es una plataforma. Usa windows, linux o las dos.`);
    }
  }
  return names as DesktopPlatform[];
}
