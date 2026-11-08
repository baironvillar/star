import { describe, expect, it } from "vite-plus/test";
import { changelogSection } from "./changelog.ts";

const CHANGELOG = `# Changelog

Texto de introducción.

## [Sin publicar]

- Algo en camino.

## [0.2.0] - 2026-11-08

### Agregado

- Registro autoservicio.

### Corregido

- El vencimiento ya no se corre un día.

## [0.1.0]

- Primera versión.

[0.2.0]: https://github.com/baironvillar/flotas/releases/tag/v0.2.0
[0.1.0]: https://github.com/baironvillar/flotas/releases/tag/v0.1.0
`;

describe("changelogSection", () => {
  it("devuelve el cuerpo sin el encabezado, con sus subsecciones", () => {
    expect(changelogSection(CHANGELOG, "0.2.0")).toBe(
      "### Agregado\n\n- Registro autoservicio.\n\n### Corregido\n\n- El vencimiento ya no se corre un día.",
    );
  });

  it("la última sección termina antes de las definiciones de enlaces", () => {
    expect(changelogSection(CHANGELOG, "0.1.0")).toBe("- Primera versión.");
  });

  it("termina en una línea ---", () => {
    expect(changelogSection("## [1.0.0]\n\nNotas.\n\n---\n\nOtra cosa.", "1.0.0")).toBe("Notas.");
  });

  it("no confunde versiones con prefijo común", () => {
    const md = "## [1.0.10]\n\nDiez.\n\n## [1.0.1]\n\nUno.\n";
    expect(changelogSection(md, "1.0.1")).toBe("Uno.");
    expect(changelogSection(md, "1.0.10")).toBe("Diez.");
  });

  it("una sección vacía o ausente es null", () => {
    expect(changelogSection("## [1.0.0]\n\n## [0.9.0]\n\nAlgo.", "1.0.0")).toBeNull();
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });

  it("acepta CRLF", () => {
    expect(changelogSection("## [1.0.0]\r\n\r\n- Uno.\r\n", "1.0.0")).toBe("- Uno.");
  });
});
