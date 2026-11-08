import { describe, expect, it } from "vite-plus/test";
import { StarError } from "../errors.ts";
import { packageJson, tauriConf } from "./json.ts";

describe("packageJson", () => {
  it("cambia sólo el número y deja el formato como estaba", () => {
    const text = `{
  "name": "app",
  "version": "0.1.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": { "dev": "vp dev" }
}
`;
    expect(packageJson.write(text, "0.2.0")).toBe(text.replace("0.1.0", "0.2.0"));
  });

  it("ignora un version anidado aunque esté antes", () => {
    const text = `{
  "engines": { "version": "9.9.9" },
  "name": "app",
  "version": "0.1.0"
}`;
    expect(packageJson.read(text)).toEqual({ version: "0.1.0" });
    const out = packageJson.write(text, "0.2.0");
    expect(out).toContain('"version": "9.9.9"');
    expect(out).toContain('"version": "0.2.0"');
  });

  it("no se confunde con strings que contienen llaves, comas o comillas", () => {
    const text = `{"description": "a, {b} \\"c\\" [d]", "version": "1.0.0"}`;
    expect(packageJson.read(text)).toEqual({ version: "1.0.0" });
  });

  it("respeta CRLF y BOM", () => {
    const text = `﻿{\r\n  "name": "app",\r\n  "version": "0.1.0"\r\n}\r\n`;
    expect(packageJson.write(text, "1.0.0")).toBe(text.replace("0.1.0", "1.0.0"));
  });

  it("falla si no hay versión", () => {
    expect(() => packageJson.read(`{"name": "app"}`)).toThrow(StarError);
  });
});

describe("tauriConf", () => {
  it("lee y escribe la versión de primer nivel, no la de wix", () => {
    const text = `{
  "productName": "App",
  "version": "0.6.0",
  "bundle": { "windows": { "wix": { "version": "1.0.0" } } }
}`;
    expect(tauriConf.read(text)).toEqual({ version: "0.6.0" });
    expect(tauriConf.write(text, "0.7.0")).toContain('"wix": { "version": "1.0.0" }');
  });

  it("una ruta a package.json es un vínculo, no una versión", () => {
    expect(tauriConf.read(`{"version": "../package.json"}`)).toEqual({
      linkedTo: "../package.json",
    });
    expect(() => tauriConf.write(`{"version": "../package.json"}`, "1.0.0")).toThrow(StarError);
  });

  it("sin versión, Tauri usa la de Cargo.toml", () => {
    expect(tauriConf.read(`{"productName": "App"}`)).toEqual({ linkedTo: "Cargo.toml" });
  });
});
