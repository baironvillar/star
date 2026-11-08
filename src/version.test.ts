import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { StarError } from "./errors.ts";
import { applyChanges, currentVersion, disagreements, inspect, planWrite } from "./version.ts";

const dirs: string[] = [];

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "star-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const pkg = (version: string, extra = "") =>
  `{\n  "name": "x",\n  "version": "${version}"${extra}\n}\n`;

describe("una app web con workspaces (flotas)", () => {
  const files = {
    "package.json": pkg("0.1.0", ',\n  "workspaces": ["apps/*", "packages/*"]'),
    "apps/api/package.json": pkg("0.1.0"),
    "apps/web/package.json": pkg("0.1.0"),
    "packages/db/package.json": pkg("0.1.0"),
    "apps/notes/README.md": "sin package.json: no es un workspace",
  };

  it("encuentra la raíz primero y cada workspace", () => {
    const entries = inspect(project(files));
    expect(entries.map((e) => e.manifest.label)).toEqual([
      "package.json",
      "apps/api/package.json",
      "apps/web/package.json",
      "packages/db/package.json",
    ]);
    expect(currentVersion(entries)).toBe("0.1.0");
    expect(disagreements(entries, "0.1.0")).toEqual([]);
  });

  it("señala el workspace que discrepa", () => {
    const entries = inspect(project({ ...files, "apps/web/package.json": pkg("0.0.9") }));
    expect(disagreements(entries, "0.1.0").map((e) => e.manifest.label)).toEqual([
      "apps/web/package.json",
    ]);
  });

  it("escribe la versión en todos", () => {
    const root = project(files);
    applyChanges(planWrite(inspect(root), "0.2.0"));
    const entries = inspect(root);
    expect(disagreements(entries, "0.2.0")).toEqual([]);
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain('"workspaces": ["apps/*"');
  });

  it("rechaza patrones de workspaces que no sabe expandir", () => {
    const root = project({ "package.json": pkg("0.1.0", ',\n  "workspaces": ["apps/**"]') });
    expect(() => inspect(root)).toThrow(StarError);
  });
});

describe("una app de escritorio (Starless)", () => {
  const files = {
    "package.json": pkg("0.6.0"),
    "src-tauri/tauri.conf.json": `{\n  "productName": "Starless",\n  "version": "0.6.0"\n}\n`,
    "src-tauri/Cargo.toml": `[package]\nname = "starless"\nversion = "0.6.0"\n\n[dependencies]\ntauri = "2"\n`,
    "src-tauri/Cargo.lock": `version = 4\n\n[[package]]\nname = "starless"\nversion = "0.6.0"\n`,
  };

  it("encuentra los cuatro manifiestos y los sube juntos", () => {
    const root = project(files);
    const entries = inspect(root);
    expect(entries.map((e) => e.manifest.label)).toEqual([
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
    ]);
    const changes = planWrite(entries, "0.7.0");
    expect(changes).toHaveLength(4);
    applyChanges(changes);
    expect(disagreements(inspect(root), "0.7.0")).toEqual([]);
  });

  it("no escribe un tauri.conf.json que apunta a package.json", () => {
    const root = project({
      ...files,
      "src-tauri/tauri.conf.json": `{\n  "version": "../package.json"\n}\n`,
    });
    const changes = planWrite(inspect(root), "0.7.0");
    expect(changes.map((c) => c.manifest.label)).not.toContain("src-tauri/tauri.conf.json");
  });

  it("si un archivo no se puede reescribir, no se escribe ninguno", () => {
    const root = project({ ...files, "src-tauri/Cargo.lock": "version = 4\n" });
    expect(() => inspect(root)).toThrow(/Cargo\.lock/);
    expect(readFileSync(join(root, "package.json"), "utf8")).toContain("0.6.0");
  });
});

it("falla con un mensaje claro si no hay package.json", () => {
  expect(() => inspect(project({}))).toThrow(/package\.json/);
});
