import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { appName, githubRepo, installRelay, RELAY_FILES, render } from "./relay-init.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function app(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "star-relay-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("githubRepo", () => {
  it("HTTPS y SSH; otra cosa no", () => {
    expect(githubRepo("https://github.com/baironvillar/Starless.git")).toBe(
      "baironvillar/Starless",
    );
    expect(githubRepo("git@github.com:baironvillar/flotas.git")).toBe("baironvillar/flotas");
    expect(githubRepo("https://gitlab.com/x/y.git")).toBeNull();
    expect(githubRepo(null)).toBeNull();
  });
});

describe("appName", () => {
  it("el productName de Tauri, o el name del package.json sin scope", () => {
    expect(
      appName(
        app({
          "package.json": '{"name":"x"}',
          "src-tauri/tauri.conf.json": '{"productName":"Starless Player"}',
        }),
      ),
    ).toBe("starless-player");
    expect(appName(app({ "package.json": '{"name":"@flota/web-app"}' }))).toBe("web-app");
  });
});

describe("installRelay", () => {
  it("copia la plantilla con el nombre y el repo, sin marcas de star sin llenar", () => {
    const root = app({ "package.json": '{"name":"demo"}' });
    const written = installRelay(root, { app: "demo", repo: "dueno/demo" });
    expect(written).toEqual(RELAY_FILES.map((f) => `relay/${f}`));
    const toml = readFileSync(join(root, "relay", "wrangler.toml"), "utf8");
    expect(toml).toContain('name = "demo-relay"');
    expect(toml).toContain('REPO = "dueno/demo"');
    expect(toml).toContain('APP = "demo"');
    for (const file of RELAY_FILES) {
      expect(readFileSync(join(root, "relay", file), "utf8")).not.toMatch(/\{\{(app|repo)\}\}/);
    }
  });

  it("no pisa un relay que ya existe", () => {
    const root = app({ "package.json": "{}", "relay/wrangler.toml": "mío" });
    expect(() => installRelay(root, { app: "x", repo: "a/b" })).toThrow(/ya hay una carpeta relay/);
    expect(readFileSync(join(root, "relay", "wrangler.toml"), "utf8")).toBe("mío");
  });

  it("render no toca las expresiones de GitHub Actions", () => {
    expect(render("${{ vars.X }} {{app}}", { app: "a", repo: "r" })).toBe("${{ vars.X }} a");
  });
});
