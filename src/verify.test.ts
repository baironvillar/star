import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { starWorkflowRefs } from "./doctor.ts";
import { gitIn } from "./git.ts";
import { verifyTag } from "./verify.ts";

describe("verifyTag con git de verdad", { timeout: 60_000 }, () => {
  let home: string;
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "star-gitconfig-"));
    writeFileSync(join(home, "config"), "");
    const env = {
      GIT_CONFIG_GLOBAL: join(home, "config"),
      GIT_AUTHOR_NAME: "star",
      GIT_AUTHOR_EMAIL: "star@example.com",
      GIT_COMMITTER_NAME: "star",
      GIT_COMMITTER_EMAIL: "star@example.com",
    };
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  });

  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  }

  /** Una app con la 0.2.0 commiteada y etiquetada, como la deja `release finish`. */
  function tagged(subject = "0.2.0", changelog = "## [0.2.0] - 2026-11-09\n\n- Algo.\n") {
    const root = mkdtempSync(join(tmpdir(), "star-verify-"));
    dirs.push(root);
    git(root, "init", "--quiet", "-b", "develop");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "0.2.0", star: { gate: ["vp check"] } }),
    );
    writeFileSync(join(root, "CHANGELOG.md"), `# Changelog\n\n${changelog}`);
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", subject);
    git(root, "tag", "-a", "v0.2.0", "-m", "0.2.0");
    return root;
  }

  const deps = (root: string, gate = true) => {
    const ran: string[][] = [];
    return {
      ran,
      deps: {
        root,
        git: gitIn(root),
        runGate: (commands: string[]) => {
          ran.push(commands);
          return gate;
        },
        log: () => {},
      },
    };
  };

  it("un tag hecho por release finish pasa, y devuelve versión y notas", () => {
    const { deps: d, ran } = deps(tagged());
    const result = verifyTag(d, "v0.2.0");
    expect(result).toMatchObject({ version: "0.2.0", notes: "- Algo." });
    // El commit, no el objeto del tag anotado.
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.commit).toBe(gitIn(d.root).commitOf("HEAD"));
    expect(ran).toEqual([["vp check"]]);
  });

  it("un tag que no es la versión de los manifiestos", () => {
    const { deps: d } = deps(tagged());
    expect(() => verifyTag(d, "v0.3.0")).toThrow(/no coincide con la versión v0\.2\.0/);
  });

  it("un merge hecho a mano, con el número del PR, no se construye", () => {
    const { deps: d, ran } = deps(tagged("0.2.0 (#7)"));
    expect(() => verifyTag(d, "v0.2.0")).toThrow(/tendría que llamarse "0\.2\.0"/);
    expect(ran).toEqual([]);
  });

  it("sin notas no corre la puerta", () => {
    const { deps: d, ran } = deps(tagged("0.2.0", "## [Sin publicar]\n"));
    expect(() => verifyTag(d, "v0.2.0")).toThrow(/no tiene notas/);
    expect(ran).toEqual([]);
  });

  it("si la puerta falla, la versión no sale", () => {
    const { deps: d } = deps(tagged(), false);
    expect(() => verifyTag(d, "v0.2.0")).toThrow(/la puerta falló/);
  });
});

describe("starWorkflowRefs", () => {
  it("lee las versiones de los workflows de star y nada más", () => {
    const yml = `
jobs:
  verify:
    uses: baironvillar/star/.github/workflows/verify.yml@v0.3.0
  release:
    uses: baironvillar/star/.github/workflows/web-release.yml@v0.3.0
  other:
    uses: someone/else/.github/workflows/x.yml@v9
#   uses: baironvillar/star/.github/workflows/verify.yml@v0.1.0
`;
    expect(starWorkflowRefs(yml)).toEqual(["0.3.0"]);
  });
});
