import { describe, expect, it } from "vite-plus/test";
import {
  checkBranch,
  checkMessage,
  checkPullRequest,
  checkPush,
  checkSubject,
  checkTitle,
  subjectOf,
} from "./conventions.ts";

const passes = (s: string) => checkSubject(s).ok;

describe("checkSubject", () => {
  it("acepta tipo(scope): asunto y la versión sola", () => {
    expect(passes("feat(machines): archive a machine instead of deleting it")).toBe(true);
    expect(passes("fix: keep the active organization")).toBe(true);
    expect(passes("chore(deps): bump hono to 4.14")).toBe(true);
    expect(passes("build(release): publish with vp run release")).toBe(true);
    expect(passes("0.4.0")).toBe(true);
    expect(passes("1.0.0-beta.2")).toBe(true);
  });

  it("deja pasar lo que escribe el propio git", () => {
    expect(passes('Revert "feat: x"')).toBe(true);
    expect(passes("fixup! feat: x")).toBe(true);
    expect(passes("Merge pull request #4 from baironvillar/release/0.1.0")).toBe(true);
    expect(passes("Merge branch 'develop'")).toBe(true);
  });

  it("rechaza lo que no sigue la forma, con el motivo", () => {
    const reason = (s: string) => {
      const v = checkSubject(s);
      return v.ok ? "" : v.reason;
    };
    expect(reason("")).toMatch(/vacío/);
    expect(reason("Add the login")).toMatch(/tipo\(scope\)/);
    expect(reason("feature: add the login")).toMatch(/tipo\(scope\)/);
    expect(reason("feat:add the login")).toMatch(/tipo\(scope\)/);
    expect(reason("feat(Auth): add the login")).toMatch(/tipo\(scope\)/);
    expect(reason("feat:  add the login")).toMatch(/más de un espacio/);
    expect(reason("feat: Add the login")).toMatch(/mayúscula/);
    expect(reason("feat: add the login.")).toMatch(/punto/);
    expect(reason("v0.4.0")).toMatch(/tipo\(scope\)/);
  });

  it("mide el largo sin el número de PR que agrega el squash de GitHub", () => {
    const at72 = `feat(release): ${"a".repeat(72 - "feat(release): ".length)}`;
    expect(at72).toHaveLength(72);
    expect(passes(at72)).toBe(true);
    expect(passes(`${at72} (#123)`)).toBe(true);
    expect(passes(`${at72}a`)).toBe(false);
  });
});

describe("checkMessage", () => {
  it("mira sólo la primera línea, sin BOM ni CR", () => {
    expect(checkMessage("﻿feat: add x\r\n\r\nWhy it was needed.\r\n").ok).toBe(true);
    expect(subjectOf("﻿fix: y\r\nbody")).toBe("fix: y");
  });
});

describe("checkBranch", () => {
  it("acepta tipo/descripcion-corta, hotfix y release/<versión>", () => {
    for (const name of ["feat/document-upload", "fix/x", "hotfix/expired-alert", "release/0.2.0"]) {
      expect(checkBranch(name).ok).toBe(true);
    }
  });

  it("rechaza lo demás", () => {
    for (const name of [
      "develop",
      "feature/x",
      "feat/Document",
      "feat/document_upload",
      "feat/-x",
      "release/v0.2.0",
      `feat/${"a".repeat(60)}`,
    ]) {
      expect(checkBranch(name).ok).toBe(false);
    }
  });
});

describe("checkPullRequest", () => {
  it("main no recibe PRs (la actualiza release finish); la base, ramas con buen nombre", () => {
    expect(checkPullRequest("develop", "main", "develop").ok).toBe(false);
    expect(checkPullRequest("feat/x", "main", "develop").ok).toBe(false);
    expect(checkPullRequest("feat/x", "develop", "develop").ok).toBe(true);
    expect(checkPullRequest("wip", "develop", "develop").ok).toBe(false);
    // Un PR encima de otro PR: si el de abajo entra primero, éste no llega nunca.
    expect(checkPullRequest("feat/b", "feat/a", "develop").ok).toBe(false);
  });
});

describe("checkPush", () => {
  const sha = "a".repeat(40);
  const zero = "0".repeat(40);
  const line = (ref: string, local = sha) => `refs/heads/x ${local} ${ref} ${zero}`;

  it("frena el push directo a main y a la base, y las ramas mal nombradas", () => {
    const stdin = [line("refs/heads/develop"), line("refs/heads/main"), line("refs/heads/wip")]
      .join("\n")
      .concat("\n");
    const results = checkPush(stdin, "develop");
    expect(results.map((r) => [r.ref, r.verdict.ok])).toEqual([
      ["develop", false],
      ["main", false],
      ["wip", false],
    ]);
  });

  it("deja pasar tags, borrados de ramas y ramas con buen nombre", () => {
    const stdin = [
      `refs/tags/v0.2.0 ${sha} refs/tags/v0.2.0 ${zero}`,
      line("refs/heads/feat/old", zero),
      line("refs/heads/feat/new"),
    ].join("\r\n");
    expect(checkPush(stdin, "develop")).toEqual([{ ref: "feat/new", verdict: { ok: true } }]);
  });

  it("protege la base que diga la configuración", () => {
    expect(checkPush(line("refs/heads/trunk"), "trunk")[0]?.verdict.ok).toBe(false);
  });
});

describe("checkTitle", () => {
  it("el título de un PR es el asunto del squash: misma regla que un commit", () => {
    expect(checkTitle("feat(lint): check the pull request title").ok).toBe(true);
    expect(checkTitle("0.6.0").ok).toBe(true);
    // Lo que propone GitHub con varios commits: el nombre de la rama.
    expect(checkTitle("Feat/squash message").ok).toBe(false);
    expect(checkTitle("feat: add a thing.").ok).toBe(false);
  });

  it("los espacios que deja el formulario de GitHub no cuentan", () => {
    expect(checkTitle("  fix: keep the tag  \n").ok).toBe(true);
  });
});
