import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { main } from "./cli.ts";
import { promoteUnreleased } from "./changelog.ts";
import { diagnose, type Finding, releaseTask } from "./doctor.ts";
import type { Gh } from "./gh.ts";
import type { Git } from "./git.ts";
import { hookScript } from "./hooks.ts";
import { type MergeSettings, wanted } from "./merge-settings.ts";
import { fakeGit } from "./testing/fake-git.ts";

const gh = (available = true, settings: MergeSettings | null = wanted("develop")): Gh => ({
  available: () => available,
  createPr: () => "",
  findPr: () => null,
  mergeSquash: () => {},
  releaseAssets: () => [],
  downloadAsset: () => null,
  secretNames: () => [],
  setSecret: () => {},
  mergeSettings: () => settings,
  updateMergeSettings: () => {},
});

/** Una app en orden: la que deja star después de adoptarlo entero. */
const healthyGit = (overrides: Partial<Git> = {}) =>
  fakeGit({
    getConfig: (key) =>
      ({ "core.hooksPath": ".githooks", "remote.origin.url": "https://github.com/x/app" })[key] ??
      null,
    remoteBranchExists: () => true,
    indexModes: (paths) => Object.fromEntries(paths.map((p) => [p, "100755"])),
    ...overrides,
  });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function app(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "star-doctor-"));
  dirs.push(root);
  const all: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "app",
      version: "0.2.0",
      scripts: { release: "bun node_modules/@baironvillar/star/src/cli.ts release" },
      devDependencies: { "vite-plus": "1.5.0" },
    }),
    "CHANGELOG.md": "# Changelog\n\n## [Sin publicar]\n\n## [0.2.0] - 2026-11-09\n\n- Algo.\n",
    ".githooks/commit-msg": hookScript("commit-msg"),
    ".githooks/pre-push": hookScript("pre-push"),
    "vite.config.ts":
      'export default { run: { tasks: { release: { command: "bun node_modules/@baironvillar/star/src/cli.ts release", cache: false } } } };\n',
    ".github/workflows/ci.yml":
      'steps:\n  - run: bunx star lint commits "$A..$B"\n  - run: bunx star lint title "$T"\n',
    ".github/PULL_REQUEST_TEMPLATE.md": "## What\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const problems = (findings: Finding[]) =>
  findings.filter((f) => f.level !== "ok").map((f) => `${f.level} ${f.area}: ${f.message}`);

describe("diagnose", () => {
  it("una app en orden no tiene nada que decir", () => {
    const git = healthyGit({ localTagExists: () => true });
    expect(problems(diagnose({ root: app(), git, gh: gh() }))).toEqual([]);
  });

  it("la app de antes de star: hooks copiados, 644, sin core.hooksPath y la CI con los sh", () => {
    const root = app({
      ".githooks/commit-msg": "#!/usr/bin/env sh\n# la regla entera\n",
      ".github/workflows/ci.yml": "steps:\n  - run: sh .githooks/commit-msg --commit HEAD\n",
      "package.json": JSON.stringify({
        version: "0.2.0",
        scripts: { version: "star version" },
        devDependencies: { "vite-plus": "1.5.0" },
      }),
    });
    const git = healthyGit({
      getConfig: (key) => (key === "remote.origin.url" ? "x" : null),
      indexModes: (paths) => Object.fromEntries(paths.map((p) => [p, "100644"])),
    });
    const found = problems(diagnose({ root, git, gh: gh() })).join("\n");
    expect(found).toMatch(/warn hooks: commit-msg falta o no es el de star/);
    expect(found).toMatch(/warn hooks: git no usa \.githooks/);
    expect(found).toMatch(/error hooks: .*no son ejecutables/);
    expect(found).toMatch(/warn ci: un workflow corre los scripts de \.githooks/);
    expect(found).toMatch(/warn ci: la CI no revisa la convención/);
    expect(found).toMatch(/warn scripts: version no llama a star por su ruta/);
  });

  it("manifiestos que discrepan, una versión publicada sin notas y una llave commiteada", () => {
    const root = app({
      "packages/web/package.json": JSON.stringify({ name: "web", version: "0.1.0" }),
      "CHANGELOG.md": "# Changelog\n\n## [0.1.0]\n\n- Antes.\n",
    });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        version: "0.2.0",
        workspaces: ["packages/*"],
        devDependencies: { "vite-plus": "1" },
      }),
    );
    const git = healthyGit({
      localTagExists: () => true,
      trackedMatching: () => ["src-tauri/updater.key"],
    });
    const found = problems(diagnose({ root, git, gh: gh(false) })).join("\n");
    expect(found).toMatch(/error versión: packages\/web\/package\.json no dicen 0\.2\.0/);
    expect(found).toMatch(/warn changelog: la 0\.2\.0 ya salió y no tiene notas/);
    expect(found).toMatch(/warn changelog: no hay una sección "## \[Sin publicar\]"/);
    expect(found).toMatch(/error secretos: .*src-tauri\/updater\.key/);
    expect(found).toMatch(/warn github: gh no está instalado/);
  });

  it("una app recién creada: dice qué falta y con qué comando, sin inventar errores", () => {
    const root = mkdtempSync(join(tmpdir(), "star-doctor-"));
    dirs.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "0.0.0", devDependencies: { "vite-plus": "1.5.0" } }),
    );
    const git = fakeGit({ remoteBranchExists: () => true, getConfig: () => null });
    const findings = diagnose({ root, git, gh: gh() }).filter((f) => f.level !== "ok");
    expect(findings.map((f) => `${f.level} ${f.area} → ${f.fix ?? ""}`)).toEqual([
      "error changelog → bun node_modules/@baironvillar/star/src/cli.ts init changelog",
      "warn hooks → bun node_modules/@baironvillar/star/src/cli.ts init hooks",
      "warn hooks → bun node_modules/@baironvillar/star/src/cli.ts init hooks",
      "warn ci → un workflow que corra la puerta y bunx star lint commits, branch y title",
      "warn github → ",
      "warn github → bun node_modules/@baironvillar/star/src/cli.ts init github",
    ]);
  });

  it("star init changelog crea uno que release sabe promover, y nunca pisa el que hay", async () => {
    const root = mkdtempSync(join(tmpdir(), "star-doctor-"));
    dirs.push(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await main(["init", "changelog"], root);
      const created = readFileSync(join(root, "CHANGELOG.md"), "utf8");
      // Vacío no se promueve (no hay nada que publicar); con una nota, sí.
      expect(promoteUnreleased(created, "0.1.0", "2026-11-09")).toBeNull();
      expect(
        promoteUnreleased(
          `${created}
- Primera versión.
`,
          "0.1.0",
          "2026-11-09",
        ),
      ).toContain("## [0.1.0] - 2026-11-09");

      writeFileSync(join(root, "CHANGELOG.md"), "# Mío\n");
      await main(["init", "changelog"], root);
      expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toBe("# Mío\n");
    } finally {
      log.mockRestore();
    }
  });

  it("sin Vite+ ni puerta configurada, release no tiene qué correr", () => {
    const root = app({ "package.json": JSON.stringify({ version: "0.2.0" }) });
    const found = problems(diagnose({ root, git: healthyGit(), gh: gh() })).join("\n");
    expect(found).toMatch(/error puerta: no hay puerta/);
  });

  it("un origin sin la rama base es un error", () => {
    const git = healthyGit({ remoteBranchExists: () => false });
    expect(problems(diagnose({ root: app(), git, gh: gh() })).join("\n")).toMatch(
      /error github: origin no tiene la rama develop/,
    );
  });

  it("un origin sin main es un error: release finish lleva ahí cada versión", () => {
    const git = healthyGit({ remoteBranchExists: (name) => name !== "main" });
    const found = diagnose({ root: app(), git, gh: gh() }).filter((f) => f.level === "error");
    expect(found.map((f) => `${f.message} → ${f.fix}`)).toEqual([
      "origin no tiene main, donde llega cada versión → bun node_modules/@baironvillar/star/src/cli.ts init github",
    ]);
  });

  it("los ajustes de merge que GitHub trae por defecto: avisa y propone star init github", () => {
    const defaults: MergeSettings = {
      allowSquash: true,
      squashTitle: "COMMIT_OR_PR_TITLE",
      squashMessage: "COMMIT_MESSAGES",
      allowMergeCommit: true,
      allowRebase: true,
      defaultBranch: "main",
    };
    const findings = diagnose({ root: app(), git: healthyGit(), gh: gh(true, defaults) });
    const merge = findings.filter((f) => f.area === "github" && f.level !== "ok");
    expect(merge).toHaveLength(1);
    expect(merge[0]?.message).toMatch(/no está como lo pide star/);
    expect(merge[0]?.message).toMatch(/merge commit: habilitado → deshabilitado/);
    expect(merge[0]?.message).toMatch(/asunto del squash: .* → el título del PR/);
    expect(merge[0]?.fix).toBe("bun node_modules/@baironvillar/star/src/cli.ts init github");
  });

  it("si no puede leer los ajustes de merge, lo dice sin frenar", () => {
    const found = problems(diagnose({ root: app(), git: healthyGit(), gh: gh(true, null) }));
    expect(found).toEqual([expect.stringMatching(/^warn github: no se pudieron leer/)]);
  });

  it("una CI que no revisa el título del PR avisa", () => {
    const root = app({
      ".github/workflows/ci.yml": 'steps:\n  - run: bunx star lint commits "$A..$B"\n',
    });
    expect(problems(diagnose({ root, git: healthyGit(), gh: gh() }))).toEqual([
      expect.stringMatching(/^warn ci: la CI no revisa el título del PR/),
    ]);
  });

  it("sin package.json, lo dice en vez de caerse", () => {
    const root = mkdtempSync(join(tmpdir(), "star-doctor-"));
    dirs.push(root);
    expect(diagnose({ root, git: healthyGit(), gh: gh() }).some((f) => f.level === "error")).toBe(
      true,
    );
  });
});

describe("scripts", () => {
  it("bunx star o star a secas: avisa y propone la ruta", () => {
    const root = app({
      "package.json": JSON.stringify({
        version: "0.2.0",
        scripts: {
          "hooks:install": "bunx star init hooks",
          ok: "bun node_modules/@baironvillar/star/src/cli.ts version",
        },
        devDependencies: { "vite-plus": "1.5.0" },
      }),
    });
    const found = diagnose({ root, git: healthyGit(), gh: gh() }).filter(
      (f) => f.area === "scripts",
    );
    expect(found.map((f) => `${f.level} ${f.message} → ${f.fix}`)).toEqual([
      "warn hooks:install no llama a star por su ruta: con `bunx star`, sin bun install corre otro paquete de npm → usa `bun node_modules/@baironvillar/star/src/cli.ts …`",
    ]);
  });
});

describe("releaseTask", () => {
  it("exige cache: false, porque con caché la tarea corre sin terminal", () => {
    expect(
      releaseTask(
        'release: { command: "bun node_modules/@baironvillar/star/src/cli.ts release", cache: false },',
      ).level,
    ).toBe("ok");
    expect(
      releaseTask('release: "bun node_modules/@baironvillar/star/src/cli.ts release",').level,
    ).toBe("error");
    expect(
      releaseTask('release: { command: "bun node_modules/@baironvillar/star/src/cli.ts release" },')
        .level,
    ).toBe("error");
    expect(releaseTask('release: { command: "./publish.sh", cache: false },').level).toBe("warn");
    expect(releaseTask("tasks: { verify: ['vp check'] }").level).toBe("ok");
    // Con bunx, sin bun install corre el paquete "star" de npm, que es otro.
    expect(releaseTask('release: { command: "bunx star release", cache: false },').level).toBe(
      "warn",
    );
  });
});
