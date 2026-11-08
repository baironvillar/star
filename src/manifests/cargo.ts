import { StarError } from "../errors.ts";
import type { VersionState } from "./types.ts";

const SECTION = /^[ \t]*\[/m;
const VERSION_LINE = /^(version[ \t]*=[ \t]*")([^"]*)(")/m;
const NAME_LINE = /^name[ \t]*=[ \t]*"([^"]*)"/m;
/** `version.workspace = true` o `version = { workspace = true }`. */
const WORKSPACE_VERSION = /^version(?:\.workspace[ \t]*=|[ \t]*=[ \t]*\{[^}]*workspace)/m;

/**
 * El bloque `[package]`, con su posición.
 *
 * Se ubica el bloque y no la primera línea `version =` del archivo: esa puede
 * ser la de una dependencia escrita en forma de tabla.
 */
function packageBlock(text: string): { start: number; end: number; body: string } {
  const header = /^[ \t]*\[package\][ \t]*\r?$/m.exec(text);
  if (!header) throw new StarError("no tiene una sección [package].");
  const start = header.index;
  const afterHeader = start + header[0].length;
  const rest = text.slice(afterHeader);
  const next = SECTION.exec(rest);
  const end = next ? afterHeader + next.index : text.length;
  return { start, end, body: text.slice(start, end) };
}

function headers(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[") && line.endsWith("]"));
}

/** El nombre del paquete, que es como lo busca `Cargo.lock`. */
export function cargoPackageName(text: string): string {
  const m = NAME_LINE.exec(packageBlock(text).body);
  if (!m?.[1]) throw new StarError("[package] no tiene name.");
  return m[1];
}

/** `Cargo.toml`: la versión de `[package]`, nunca la de una dependencia. */
export const cargoToml = {
  read(text: string): VersionState {
    const { body } = packageBlock(text);
    if (WORKSPACE_VERSION.test(body)) {
      // Seguirla hasta el [workspace.package] de otro Cargo.toml es posible,
      // pero ninguna app lo usa todavía. Mejor decirlo que dejar una versión
      // sin sincronizar en silencio.
      throw new StarError(
        "usa version.workspace = true, y eso todavía no está soportado: pon la versión en [package].",
      );
    }
    const m = VERSION_LINE.exec(body);
    if (!m) throw new StarError("[package] no tiene version.");
    return { version: m[2] ?? "" };
  },

  /**
   * Reemplaza la versión dentro de `[package]` y nada más.
   *
   * En Starless la primera versión partía el archivo en `[dependencies]` y lo
   * volvía a unir: `split` saca el separador y `join` sólo lo devuelve si hay
   * más de un pedazo, así que el encabezado desaparecía y `tauri` pasaba a ser
   * una dependencia de build. El archivo seguía siendo válido, los manifiestos
   * coincidían, y `cargo check` fallaba dentro de `tauri-build` con un mensaje
   * que no tenía nada que ver. Por eso se verifica que los encabezados de
   * sección sean los mismos antes y después.
   */
  write(text: string, version: string): string {
    const block = packageBlock(text);
    if (!VERSION_LINE.test(block.body)) throw new StarError("[package] no tiene version.");
    const body = block.body.replace(VERSION_LINE, `$1${version}$3`);
    const out = text.slice(0, block.start) + body + text.slice(block.end);
    if (headers(text).join("|") !== headers(out).join("|")) {
      throw new StarError("al reescribir la versión cambiaron los encabezados de sección.");
    }
    return out;
  },
};

/** Los bloques `[[package]]` de un `Cargo.lock`. */
function lockBlocks(text: string): { start: number; end: number; body: string }[] {
  const starts: number[] = [];
  const re = /^\[\[package\]\][ \t]*\r?$/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) starts.push(m.index);
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? text.length;
    return { start, end, body: text.slice(start, end) };
  });
}

/**
 * `Cargo.lock`: la entrada del paquete de la app.
 *
 * **El lock lleva la versión del paquete que bloquea.** Nadie lo lee para
 * saber qué versión es la app, pero se commitea, y `cargo` reescribe esa línea
 * en el primer build. Un bump que lo deja atrás produce un árbol sucio después
 * del primer build y un diff que nadie pidió en medio de una release.
 *
 * La entrada se busca por el nombre y sin `source`: los paquetes locales no
 * tienen, y así una dependencia que se llame igual no se confunde con la app.
 */
export function cargoLock(name: string) {
  function find(text: string) {
    const nameLine = new RegExp(
      `^name = "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\r?$`,
      "m",
    );
    const matches = lockBlocks(text).filter(
      (b) => nameLine.test(b.body) && !/^source = /m.test(b.body),
    );
    if (matches.length === 0) throw new StarError(`no tiene una entrada [[package]] "${name}".`);
    if (matches.length > 1) throw new StarError(`tiene más de una entrada local "${name}".`);
    const block = matches[0];
    if (!block) throw new StarError(`no tiene una entrada [[package]] "${name}".`);
    return block;
  }

  return {
    read(text: string): VersionState {
      const m = VERSION_LINE.exec(find(text).body);
      if (!m) throw new StarError(`la entrada "${name}" no tiene version.`);
      return { version: m[2] ?? "" };
    },
    write(text: string, version: string): string {
      const block = find(text);
      const body = block.body.replace(VERSION_LINE, `$1${version}$3`);
      return text.slice(0, block.start) + body + text.slice(block.end);
    },
  };
}
