import { describe, expect, it } from "vite-plus/test";
import { StarError } from "../errors.ts";
import { cargoLock, cargoPackageName, cargoToml } from "./cargo.ts";

const TOML = `[package]
name = "starless"
version = "0.6.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }

[dependencies.serde]
version = "1.0.0"
`;

describe("cargoToml", () => {
  it("lee la versión de [package] y el nombre", () => {
    expect(cargoToml.read(TOML)).toEqual({ version: "0.6.0" });
    expect(cargoPackageName(TOML)).toBe("starless");
  });

  it("cambia sólo [package] y conserva todos los encabezados", () => {
    const out = cargoToml.write(TOML, "0.7.0");
    expect(out).toBe(TOML.replace('version = "0.6.0"', 'version = "0.7.0"'));
    expect(out).toContain("[dependencies]\ntauri =");
    expect(out).toContain('[dependencies.serde]\nversion = "1.0.0"');
  });

  it("respeta CRLF", () => {
    const crlf = TOML.replaceAll("\n", "\r\n");
    expect(cargoToml.write(crlf, "0.7.0")).toBe(crlf.replace('"0.6.0"', '"0.7.0"'));
  });

  it("no busca la versión fuera de [package]", () => {
    const text = `[package]\nname = "app"\n\n[dependencies.serde]\nversion = "1.0.0"\n`;
    expect(() => cargoToml.read(text)).toThrow(/no tiene version/);
  });

  it("avisa que version.workspace todavía no está soportado", () => {
    const text = `[package]\nname = "app"\nversion.workspace = true\n`;
    expect(() => cargoToml.read(text)).toThrow(StarError);
    expect(() => cargoToml.read(text)).toThrow(/workspace/);
  });
});

const LOCK = `version = 4

[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "starless"
version = "0.6.0"
dependencies = [
 "serde",
]

[[package]]
name = "starless"
version = "0.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;

describe("cargoLock", () => {
  it("cambia la entrada local por nombre, no una dependencia homónima", () => {
    const lock = cargoLock("starless");
    expect(lock.read(LOCK)).toEqual({ version: "0.6.0" });
    const out = lock.write(LOCK, "0.7.0");
    expect(out).toBe(
      LOCK.replace('name = "starless"\nversion = "0.6.0"', 'name = "starless"\nversion = "0.7.0"'),
    );
    expect(out).toContain('version = "0.1.0"\nsource');
  });

  it("falla si la app no está en el lock", () => {
    expect(() => cargoLock("otra").read(LOCK)).toThrow(StarError);
  });
});
