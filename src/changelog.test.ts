import { describe, expect, it } from "vite-plus/test";
import { changelogSection, copyUnreleased, promoteUnreleased, today } from "./changelog.ts";

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

describe("promoteUnreleased", () => {
  const md =
    "# Changelog\n\n## [Sin publicar]\n\n### Agregado\n\n- Algo nuevo.\n\n## [0.1.0]\n\n- Antes.\n";

  it("convierte lo sin publicar en la versión y deja la sección vacía arriba", () => {
    const out = promoteUnreleased(md, "0.2.0", "2026-11-08");
    expect(out).toBe(
      "# Changelog\n\n## [Sin publicar]\n\n## [0.2.0] - 2026-11-08\n\n### Agregado\n\n- Algo nuevo.\n\n## [0.1.0]\n\n- Antes.\n",
    );
    expect(changelogSection(out ?? "", "0.2.0")).toBe("### Agregado\n\n- Algo nuevo.");
    expect(changelogSection(out ?? "", "0.1.0")).toBe("- Antes.");
  });

  it("acepta [Unreleased] y conserva CRLF", () => {
    const crlf = "## [Unreleased]\r\n\r\n- Uno.\r\n";
    expect(promoteUnreleased(crlf, "1.0.0", "2026-01-02")).toBe(
      "## [Unreleased]\r\n\r\n## [1.0.0] - 2026-01-02\r\n\r\n- Uno.\r\n",
    );
  });

  it("sin nada sin publicar no hay qué promover", () => {
    expect(
      promoteUnreleased("## [Sin publicar]\n\n## [0.1.0]\n\n- Antes.\n", "0.2.0", "x"),
    ).toBeNull();
    expect(promoteUnreleased("## [0.1.0]\n\n- Antes.\n", "0.2.0", "x")).toBeNull();
  });
});

describe("today", () => {
  it("usa la fecha local", () => {
    expect(today(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("copyUnreleased", () => {
  const md =
    "# Changelog\n\n## [Sin publicar]\n\n- Algo nuevo.\n\n## [0.6.0] - 2026-11-01\n\n- Antes.\n";

  it("copia lo sin publicar a la beta y lo deja para la versión final", () => {
    const beta = copyUnreleased(md, "0.7.0-beta.1", "2026-11-10");
    expect(beta).toBe(
      "# Changelog\n\n## [Sin publicar]\n\n- Algo nuevo.\n\n## [0.7.0-beta.1] - 2026-11-10\n\n- Algo nuevo.\n\n## [0.6.0] - 2026-11-01\n\n- Antes.\n",
    );
    // La versión final se lleva todo lo de las betas.
    const final = promoteUnreleased(beta ?? "", "0.7.0", "2026-11-20") ?? "";
    expect(changelogSection(final, "0.7.0")).toBe("- Algo nuevo.");
    expect(changelogSection(final, "0.7.0-beta.1")).toBe("- Algo nuevo.");
  });

  it("al final del archivo y con CRLF", () => {
    const crlf = "# C\r\n\r\n## [Sin publicar]\r\n\r\n- Uno.\r\n";
    expect(copyUnreleased(crlf, "0.1.0-beta.1", "2026-11-10")).toBe(
      "# C\r\n\r\n## [Sin publicar]\r\n\r\n- Uno.\r\n\r\n## [0.1.0-beta.1] - 2026-11-10\r\n\r\n- Uno.\r\n",
    );
  });

  it("sin nada sin publicar no hay beta", () => {
    expect(
      copyUnreleased("# C\n\n## [Sin publicar]\n\n## [0.6.0]\n\n- x\n", "0.7.0-beta.1", "d"),
    ).toBeNull();
  });
});
