/** Lo que dice un manifiesto sobre la versión. */
export type VersionState =
  /** El archivo tiene su propia copia del número, y hay que mantenerla. */
  | { version: string }
  /** El archivo no tiene número propio: lo toma de otro, que es el que se escribe. */
  | { linkedTo: string };

/**
 * Un archivo que lleva la versión de la app.
 *
 * `read` y `write` trabajan sobre el texto y no tocan el disco: así se prueban
 * sin archivos, y un bump arma todos los textos nuevos antes de escribir el
 * primero.
 */
export type Manifest = {
  /** Ruta absoluta. */
  path: string;
  /** Ruta relativa a la raíz, para mostrarla. */
  label: string;
  read(text: string): VersionState;
  /** Devuelve el texto con la versión nueva. Falla si no puede hacerlo sin tocar nada más. */
  write(text: string, version: string): string;
};

export function hasOwnVersion(state: VersionState): state is { version: string } {
  return "version" in state;
}
