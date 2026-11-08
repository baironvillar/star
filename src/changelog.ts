import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StarError } from "./errors.ts";

/**
 * Las notas de una versión: el cuerpo de su sección en `CHANGELOG.md`.
 *
 * La sección empieza en `## [x.y.z]` (con lo que venga después en la misma
 * línea, como la fecha) y termina en el siguiente encabezado de nivel 1 o 2,
 * en una línea `---`, o en las definiciones de enlaces del final
 * (`[0.1.0]: https://…`) que usa Keep a Changelog. El encabezado no se
 * incluye: el título de la release ya es la versión.
 *
 * Una sección que existe pero está vacía cuenta como que no existe: una
 * release sin notas es justo lo que esto evita.
 */
export function changelogSection(markdown: string, version: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##[ \\t]+\\[${escaped}\\]([ \\t].*)?$`);

  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return null;

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (
      /^#{1,2}[ \t]/.test(line) ||
      /^-{3,}[ \t]*$/.test(line) ||
      /^\[[^\]]+\]:[ \t]+\S/.test(line)
    ) {
      break;
    }
    body.push(line);
  }
  const text = body.join("\n").trim();
  return text === "" ? null : text;
}

export function readChangelog(root: string): string {
  const path = join(root, "CHANGELOG.md");
  if (!existsSync(path)) {
    throw new StarError("no hay un CHANGELOG.md en la raíz: las notas de cada versión viven ahí.");
  }
  return readFileSync(path, "utf8");
}
