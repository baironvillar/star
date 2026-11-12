import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Gh } from "./gh.ts";
import { gitIn } from "./git.ts";
import {
  applyGithub,
  describePlan,
  INITIAL_COMMIT,
  missingFiles,
  planBootstrap,
  planGithub,
} from "./github-init.ts";
import { type MergeSettings, wanted } from "./merge-settings.ts";
import { fakeGit } from "./testing/fake-git.ts";

const GITHUB_DEFAULTS: MergeSettings = {
  allowSquash: true,
  squashTitle: "COMMIT_OR_PR_TITLE",
  squashMessage: "COMMIT_MESSAGES",
  allowMergeCommit: true,
  allowRebase: true,
  defaultBranch: "",
};

/** Un GitHub de mentira que guarda los ajustes que le mandan. */
function fakeGh(initial: MergeSettings = GITHUB_DEFAULTS): Gh & { patches: object[] } {
  let settings = initial;
  const patches: object[] = [];
  return {
    patches,
    available: () => true,
    createPr: () => "",
    findPr: () => null,
    viewPr: () => null,
    mergeSquash: () => {},
    releaseAssets: () => [],
    downloadAsset: () => null,
    secretNames: () => [],
    setSecret: () => {},
    mergeSettings: () => settings,
    updateMergeSettings(fields) {
      patches.push(fields);
      settings = wanted("develop");
    },
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "star-github-"));
  dirs.push(dir);
  return dir;
}

describe("planBootstrap", () => {
  const remote = (main: boolean | null, develop: boolean | null) => (name: string) =>
    name === "main" ? main : develop;

  it("con main y la base en origin no hay nada que crear", () => {
    const git = fakeGit({ remoteBranchExists: remote(true, true) });
    expect(planBootstrap(git, "develop")).toEqual({ kind: "ready" });
  });

  it("falta una: se crea desde la otra", () => {
    expect(planBootstrap(fakeGit({ remoteBranchExists: remote(true, false) }), "develop")).toEqual({
      kind: "missing",
      branch: "develop",
      from: "main",
    });
    expect(planBootstrap(fakeGit({ remoteBranchExists: remote(false, true) }), "develop")).toEqual({
      kind: "missing",
      branch: "main",
      from: "develop",
    });
  });

  it("ninguna y sin commits: un repo nuevo", () => {
    const git = fakeGit({ remoteBranchExists: remote(false, false), hasCommits: () => false });
    expect(planBootstrap(git, "develop")).toEqual({ kind: "empty" });
  });

  it("ninguna, pero la rama tiene historia: no le inventa un commit inicial", () => {
    const git = fakeGit({ remoteBranchExists: remote(false, false), hasCommits: () => true });
    expect(() => planBootstrap(git, "develop")).toThrow(/Empújala como develop/);
  });

  it("sin poder preguntar a origin, no adivina", () => {
    const git = fakeGit({ remoteBranchExists: remote(null, true) });
    expect(() => planBootstrap(git, "develop")).toThrow(/no se pudo preguntar a origin/);
  });
});

describe("missingFiles", () => {
  it("en una app sin nada, el workflow del título y la plantilla de PR", () => {
    const files = missingFiles(tempDir());
    expect(files.map((f) => f.path)).toEqual([
      ".github/workflows/pr-title.yml",
      ".github/PULL_REQUEST_TEMPLATE.md",
    ]);
    expect(files[0]?.content).toMatch(/bunx star lint title "\$PR_TITLE"/);
  });

  it("no toca una plantilla que ya es de la app, ni duplica la revisión del título", () => {
    const root = tempDir();
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "## Mía\n");
    writeFileSync(
      join(root, ".github", "workflows", "ci.yml"),
      'steps:\n  - run: bunx star lint title "$T"\n',
    );
    expect(missingFiles(root)).toEqual([]);
  });
});

describe("describePlan", () => {
  it("un repo en orden no tiene nada que mostrar", () => {
    const root = tempDir();
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "PULL_REQUEST_TEMPLATE.md"), "## What\n");
    writeFileSync(join(root, ".github", "workflows", "pr-title.yml"), "star lint title\n");
    const git = fakeGit({ remoteBranchExists: () => true });
    const plan = planGithub(root, git, fakeGh(wanted("develop")), "develop");
    expect(describePlan(plan, "develop")).toEqual([]);
  });
});

describe("applyGithub con git", { timeout: 60_000 }, () => {
  let home: string;
  const saved: Record<string, string | undefined> = {};
  const isolate = {
    GIT_AUTHOR_NAME: "star",
    GIT_AUTHOR_EMAIL: "star@example.com",
    GIT_COMMITTER_NAME: "star",
    GIT_COMMITTER_EMAIL: "star@example.com",
  };

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "star-gitconfig-"));
    writeFileSync(join(home, "config"), "");
    for (const [k, v] of Object.entries({ ...isolate, GIT_CONFIG_GLOBAL: join(home, "config") })) {
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

  function git(cwd: string, ...args: string[]): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  }

  /** Lo que tenía sme: un repo vacío en GitHub y el trabajo en el stage de una rama sin commits. */
  function emptyRepo(branch: string) {
    const dir = tempDir();
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    git(dir, "init", "--quiet", "--bare", origin);
    mkdirSync(work);
    git(work, "init", "--quiet", "-b", branch);
    git(work, "remote", "add", "origin", origin);
    writeFileSync(join(work, "README.md"), "# app\n");
    git(work, "add", "README.md");
    return { work, origin };
  }

  it("un repo vacío: commit inicial sin el trabajo en el stage, main y develop en origin", async () => {
    const { work, origin } = emptyRepo("docs/foundations");
    const gitW = gitIn(work);
    const gh = fakeGh();
    const plan = planGithub(work, gitW, gh, "develop");
    expect(plan.bootstrap).toEqual({ kind: "empty" });
    expect(describePlan(plan, "develop")).toContain("rebase and merge: habilitado → deshabilitado");

    const result = await applyGithub(plan, work, gitW, gh, "develop");

    expect(result).toEqual({ uncommitted: [], onProtected: null });
    // main y develop en origin, en el mismo commit inicial, con sólo los archivos de star.
    expect(git(origin, "rev-parse", "main")).toBe(git(origin, "rev-parse", "develop"));
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe(INITIAL_COMMIT);
    expect(git(origin, "ls-tree", "-r", "--name-only", "main").split("\n").sort()).toEqual([
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/workflows/pr-title.yml",
    ]);
    // La rama de trabajo comparte la historia, y su stage quedó como estaba.
    expect(git(work, "rev-parse", "HEAD")).toBe(git(origin, "rev-parse", "main"));
    expect(git(work, "status", "--porcelain")).toBe("A  README.md");
    expect(existsSync(join(work, ".github", "workflows", "pr-title.yml"))).toBe(true);
    // Sólo squash, desde el PR, y develop por defecto.
    expect(gh.patches).toEqual([
      {
        squash_merge_commit_title: "PR_TITLE",
        squash_merge_commit_message: "PR_BODY",
        allow_merge_commit: false,
        allow_rebase_merge: false,
        default_branch: "develop",
      },
    ]);
  });

  it("si estaba parado en main, lo avisa: ahí no se commitea", async () => {
    const { work } = emptyRepo("main");
    const gitW = gitIn(work);
    const gh = fakeGh();
    const result = await applyGithub(
      planGithub(work, gitW, gh, "develop"),
      work,
      gitW,
      gh,
      "develop",
    );
    expect(result.onProtected).toBe("main");
  });

  it("un repo con develop y sin main: crea main desde el primer commit", async () => {
    const { work, origin } = emptyRepo("develop");
    git(work, "commit", "--quiet", "-m", "chore: start");
    writeFileSync(join(work, "app.ts"), "export {};\n");
    git(work, "add", "app.ts");
    git(work, "commit", "--quiet", "-m", "feat: app");
    git(work, "push", "--quiet", "origin", "develop");
    const gitW = gitIn(work);
    const gh = fakeGh();
    const plan = planGithub(work, gitW, gh, "develop");
    expect(plan.bootstrap).toEqual({ kind: "missing", branch: "main", from: "develop" });

    git(work, "fetch", "--quiet", "origin");
    const result = await applyGithub(plan, work, gitW, gh, "develop");

    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("chore: start");
    // Con historia, los archivos quedan para un PR.
    expect(result.uncommitted).toEqual([
      ".github/workflows/pr-title.yml",
      ".github/PULL_REQUEST_TEMPLATE.md",
    ]);
    expect(readFileSync(join(work, ".github", "PULL_REQUEST_TEMPLATE.md"), "utf8")).toMatch(
      /star init github/,
    );
  });
});
