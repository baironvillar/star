import { StarError } from "./errors.ts";

/** Dónde está, dentro del texto, el valor string de una clave. */
export type StringSpan = {
  /** Índice del primer carácter después de la comilla de apertura. */
  start: number;
  /** Índice de la comilla de cierre. */
  end: number;
  /** El valor ya decodificado. */
  value: string;
};

/**
 * El valor de una clave **de primer nivel** de un JSON, con su posición.
 *
 * **Por qué no `JSON.parse` + `JSON.stringify`.** Volver a serializar el
 * archivo lo reformatea entero: los arrays que el formateador dejaba en una
 * línea vuelven desarmados. En Starless cada bump rompía el lint por eso, y hubo
 * que reformatear a mano dos veces, una de ellas en el bump de una release.
 * Cambiando sólo los caracteres del valor, un bump es un diff de una línea.
 *
 * **Por qué no una expresión regular.** `"version"` aparece también anidado: en
 * `tauri.conf.json` está `bundle.windows.wix.version`, y en un `package.json`
 * puede haberlo dentro de cualquier objeto. La primera coincidencia de un regex
 * no es necesariamente la de primer nivel; este recorrido sí lo sabe.
 *
 * Devuelve `null` si la clave no existe o su valor no es un string.
 */
export function findTopLevelString(text: string, key: string): StringSpan | null {
  let i = 0;
  // Un BOM al principio lo deja el Bloc de notas y algunas versiones de PowerShell.
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  i = skipSpace(text, i);
  if (text[i] !== "{") throw new StarError("el archivo no es un objeto JSON.");

  let depth = 0;
  let expectKey = false;

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const str = readString(text, i);
      if (depth === 1 && expectKey) {
        expectKey = false;
        let j = skipSpace(text, str.next);
        if (text[j] !== ":") throw new StarError(`JSON inválido cerca de la posición ${j}.`);
        j = skipSpace(text, j + 1);
        if (str.value === key) {
          if (text[j] !== '"') return null;
          const value = readString(text, j);
          return { start: j + 1, end: value.next - 1, value: value.value };
        }
        i = j;
        continue;
      }
      i = str.next;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      expectKey = ch === "{" && depth === 1;
    } else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return null;
    } else if (ch === "," && depth === 1) {
      expectKey = true;
    }
    i++;
  }
  throw new StarError("el JSON termina antes de cerrar el objeto.");
}

/** Reemplaza el valor de un string que ya se ubicó con {@link findTopLevelString}. */
export function replaceSpan(text: string, span: StringSpan, value: string): string {
  // JSON.stringify escapa lo que haga falta; se le sacan las comillas porque
  // las del archivo se quedan donde están.
  const encoded = JSON.stringify(value).slice(1, -1);
  return text.slice(0, span.start) + encoded + text.slice(span.end);
}

function skipSpace(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  return i;
}

function readString(text: string, start: number): { value: string; next: number } {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') {
      const raw = text.slice(start, i + 1);
      return { value: JSON.parse(raw) as string, next: i + 1 };
    }
    i++;
  }
  throw new StarError("hay un string sin cerrar en el JSON.");
}

/**
 * El valor string que está en una ruta de claves (`["plugins", "updater",
 * "pubkey"]`), con su posición. Igual que {@link findTopLevelString}, para
 * cambiar sólo esos caracteres sin reformatear el archivo.
 *
 * Devuelve `null` si la ruta no existe o el valor no es un string.
 */
export function findStringAt(text: string, path: readonly string[]): StringSpan | null {
  let found: StringSpan | null = null;

  // `rest` es lo que falta de la ruta si este valor está en ella, o `null`.
  function value(i: number, rest: readonly string[] | null): number {
    i = skipSpace(text, i);
    const ch = text[i];
    if (ch === '"') return readString(text, i).next;
    if (ch === "{") {
      i = skipSpace(text, i + 1);
      if (text[i] === "}") return i + 1;
      for (;;) {
        if (text[i] !== '"') throw new StarError(`JSON inválido cerca de la posición ${i}.`);
        const key = readString(text, i);
        i = skipSpace(text, key.next);
        if (text[i] !== ":") throw new StarError(`JSON inválido cerca de la posición ${i}.`);
        const onPath = rest !== null && rest[0] === key.value;
        const start = skipSpace(text, i + 1);
        if (onPath && rest.length === 1) {
          if (text[start] === '"') {
            const str = readString(text, start);
            found = { start: start + 1, end: str.next - 1, value: str.value };
          }
        }
        i = skipSpace(text, value(start, onPath && rest.length > 1 ? rest.slice(1) : null));
        if (text[i] === ",") {
          i = skipSpace(text, i + 1);
          continue;
        }
        if (text[i] === "}") return i + 1;
        throw new StarError(`JSON inválido cerca de la posición ${i}.`);
      }
    }
    if (ch === "[") {
      i = skipSpace(text, i + 1);
      if (text[i] === "]") return i + 1;
      for (;;) {
        i = skipSpace(text, value(i, null));
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") return i + 1;
        throw new StarError(`JSON inválido cerca de la posición ${i}.`);
      }
    }
    // Número, true, false o null: hasta el siguiente separador.
    while (i < text.length && !/[\s,}\]]/.test(text[i] ?? "")) i++;
    return i;
  }

  value(text.charCodeAt(0) === 0xfeff ? 1 : 0, path);
  return found;
}
