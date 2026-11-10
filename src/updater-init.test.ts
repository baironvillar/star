import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { findStringAt } from "./json-text.ts";
import {
  importKey,
  inspectUpdater,
  keysDir,
  planUpdater,
  PRIVATE_SECRET,
  uploadKey,
  writePubkey,
} from "./updater-init.ts";

describe("findStringAt", () => {
  const text = `﻿{
  "version": "1.0.0",
  "bundle": { "windows": { "wix": { "version": "9" } }, "targets": ["msi", 1, true, null] },
  "plugins": { "updater": { "active": true, "pubkey": "abc\\"d", "endpoints": [] } }
}`;

  it("encuentra un string anidado sin confundirlo con otro del mismo nombre", () => {
    expect(findStringAt(text, ["plugins", "updater", "pubkey"])?.value).toBe('abc"d');
    expect(findStringAt(text, ["bundle", "windows", "wix", "version"])?.value).toBe("9");
    expect(findStringAt(text, ["version"])?.value).toBe("1.0.0");
  });

  it("null si la ruta no existe o no es un string", () => {
    expect(findStringAt(text, ["plugins", "updater", "active"])).toBeNull();
    expect(findStringAt(text, ["plugins", "nada", "pubkey"])).toBeNull();
  });
});

describe("init updater", () => {
  let home: string;
  let root: string;
  const saved = process.env.STAR_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "star-home-"));
    root = mkdtempSync(join(tmpdir(), "star-tauri-"));
    process.env.STAR_HOME = home;
    mkdirSync(join(root, "src-tauri"));
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.STAR_HOME;
    else process.env.STAR_HOME = saved;
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  /** Un tauri.conf.json con el formato a mano, para ver que no se reformatea. */
  function conf(pubkey: string | null, artifacts = true) {
    const updater =
      pubkey === null
        ? ""
        : `,\n  "plugins": { "updater": { "pubkey": "${pubkey}", "endpoints": [] } }`;
    writeFileSync(
      join(root, "src-tauri", "tauri.conf.json"),
      `{\n  "identifier": "app.prueba",\n  "bundle": { "targets": ["msi"], "createUpdaterArtifacts": ${artifacts} }${updater}\n}\n`,
    );
  }
  const gh = (names: string[] | null = []) => {
    const set: Record<string, string> = {};
    return {
      set,
      secretNames: () => names,
      setSecret: (name: string, value: string) => {
        set[name] = value;
      },
    };
  };
  function backup(pub: string, key = "llave-privada") {
    const dir = keysDir("app.prueba");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "updater.key"), key);
    writeFileSync(join(dir, "updater.key.pub"), `${pub}\n`);
  }
  const plan = (names: string[] | null = []) => {
    const state = inspectUpdater(root, gh(names));
    if (!state) throw new Error("no es tauri");
    return planUpdater(state);
  };

  it("una app web no tiene updater", () => {
    rmSync(join(root, "src-tauri"), { recursive: true });
    expect(inspectUpdater(root, gh())).toBeNull();
  });

  it("sin el bloque del updater, dice qué agregar", () => {
    conf(null);
    const p = plan();
    expect(p.action).toBe("blocked");
    expect(p.action === "blocked" && p.reason).toMatch(/"pubkey": ""/);
  });

  it("con la pública vacía y sin respaldo, genera", () => {
    conf("");
    expect(plan()).toEqual({ action: "generate" });
  });

  it("nunca genera si ya hay una llave en el respaldo", () => {
    conf("");
    backup("PUB");
    expect(plan().action).toBe("blocked");
  });

  it("una app con llave, secreto y respaldo está lista", () => {
    conf("PUB");
    backup("PUB");
    expect(plan([PRIVATE_SECRET])).toEqual({ action: "ready", warnings: [] });
  });

  it("sin respaldo avisa; sin secreto y con respaldo, lo sube", () => {
    conf("PUB");
    const ready = plan([PRIVATE_SECRET]);
    expect(ready.action === "ready" && ready.warnings.join()).toMatch(/no hay respaldo/);
    backup("PUB");
    expect(plan([])).toEqual({ action: "upload" });
  });

  it("sin secreto ni respaldo no hay de dónde sacar la llave", () => {
    conf("PUB");
    const p = plan([]);
    expect(p.action === "blocked" && p.reason).toMatch(/--import/);
  });

  it("un respaldo de otra llave frena todo", () => {
    conf("PUB");
    backup("OTRA");
    const p = plan([PRIVATE_SECRET]);
    expect(p.action === "blocked" && p.reason).toMatch(/no es la de tauri\.conf\.json/);
  });

  it("escribe la pública cambiando sólo esos caracteres", () => {
    conf("");
    const before = readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8");
    const state = inspectUpdater(root, gh());
    if (!state) throw new Error("no es tauri");
    writePubkey(state, "NUEVA");
    expect(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).toBe(
      before.replace('"pubkey": ""', '"pubkey": "NUEVA"'),
    );
  });

  it("importa una llave sólo si su pública es la de la app, y la sube por stdin", () => {
    conf("PUB");
    const source = join(root, "vieja.key");
    writeFileSync(source, "llave-de-antes");
    writeFileSync(`${source}.pub`, "OTRA");
    const state = inspectUpdater(root, gh());
    if (!state) throw new Error("no es tauri");
    expect(() => importKey(state, source)).toThrow(/no es la de esta app/);

    writeFileSync(`${source}.pub`, "PUB\n");
    importKey(state, source);
    expect(readFileSync(join(keysDir("app.prueba"), "updater.key"), "utf8")).toBe("llave-de-antes");

    const after = inspectUpdater(root, gh());
    if (!after) throw new Error("no es tauri");
    const remote = gh();
    uploadKey(after, remote);
    expect(remote.set).toEqual({ [PRIVATE_SECRET]: "llave-de-antes" });
  });
});
