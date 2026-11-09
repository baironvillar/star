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
  return sectionBody(lines, start);
}

/** Lo que va después del encabezado `start`, hasta donde termina la sección. */
function sectionBody(lines: string[], start: number): string | null {
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

const UNRELEASED = /^##[ \t]+\[(Sin publicar|No publicado|Unreleased)\][ \t]*$/i;

/**
 * El changelog con lo "sin publicar" convertido en la sección de `version`.
 *
 * Es el paso que cada release hacía a mano: renombrar `## [Sin publicar]` a
 * `## [0.2.0] - 2026-11-20` y dejar un `## [Sin publicar]` vacío arriba. Se
 * hace igual que a mano, con el mismo encabezado que ya tenía el archivo, y
 * se muestra antes de escribirlo.
 *
 * Devuelve `null` si no hay sección sin publicar o está vacía: entonces no
 * hay notas, y la versión no sale.
 */
export function promoteUnreleased(markdown: string, version: string, date: string): string | null {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => UNRELEASED.test(line));
  if (start < 0 || sectionBody(lines, start) === null) return null;
  const promoted = [
    ...lines.slice(0, start + 1),
    "",
    `## [${version}] - ${date}`,
    ...lines.slice(start + 1),
  ];
  return promoted.join(eol);
}

/** La fecha de hoy en la hora de la máquina: la release sale el día que se ve en el reloj. */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * El changelog de una app que recién empieza: sin versiones, con la sección
 * donde se va anotando lo próximo.
 */
export const EMPTY_CHANGELOG = `# Changelog

Los cambios que nota quien usa la app. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [SemVer](https://semver.org/lang/es/).

## [Sin publicar]
`;

export function readChangelog(root: string): string {
  const path = join(root, "CHANGELOG.md");
  if (!existsSync(path)) {
    throw new StarError("no hay un CHANGELOG.md en la raíz: las notas de cada versión viven ahí.");
  }
  return readFileSync(path, "utf8");
}
