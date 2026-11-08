import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { readConfig } from "./config.ts";
import { StarError } from "./errors.ts";

const dirs: string[] = [];
function withPackage(pkg: object): string {
  const root = mkdtempSync(join(tmpdir(), "star-config-"));
  dirs.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  return root;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readConfig", () => {
  it("con Vite+ y sin configurar: develop, vp check y vp test", () => {
    expect(readConfig(withPackage({ devDependencies: { "vite-plus": "1.5.0" } }))).toEqual({
      base: "develop",
      gate: ["vp check", "vp test run"],
    });
  });

  it("sin Vite+ no adivina la puerta", () => {
    expect(readConfig(withPackage({})).gate).toBeNull();
  });

  it("lee base y puerta de la clave star", () => {
    expect(readConfig(withPackage({ star: { base: "main", gate: "vp run verify" } }))).toEqual({
      base: "main",
      gate: ["vp run verify"],
    });
    expect(readConfig(withPackage({ star: { gate: ["biome check", "bun test"] } })).gate).toEqual([
      "biome check",
      "bun test",
    ]);
  });

  it("rechaza una configuración con otra forma", () => {
    expect(() => readConfig(withPackage({ star: { gate: 1 } }))).toThrow(StarError);
    expect(() => readConfig(withPackage({ star: { base: ["x"] } }))).toThrow(StarError);
  });
});
