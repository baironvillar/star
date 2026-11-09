import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn } from "./git.ts";
import { hookScript, inspectHooks, installHooks, lintCommits } from "./hooks.ts";
import { fakeGit } from "./testing/fake-git.ts";

describe("lintCommits", () => {
  const messages: Record<string, string> = {
    base: "chore: start",
    a: "feat: add x\n\nbody",
    b: "Add y",
  };
  const git = fakeGit({
    commitMessage: (rev) => messages[rev] ?? null,
    commitsBetween: () => ["b", "a"],
  });

  it("revisa cada commit del rango", () => {
    const results = lintCommits(git, "base..b").results;
    expect(results.map((r) => [r.sha, r.subject, r.verdict.ok])).toEqual([
      ["b", "Add y", false],
      ["a", "feat: add x", true],
    ]);
  });

  it("con la base en ceros o fuera del clon mira sólo la punta", () => {
    const zero = lintCommits(git, `${"0".repeat(40)}..a`);
    expect(zero.onlyTip).toBe(true);
    expect(zero.results.map((r) => r.sha)).toEqual(["a"]);
    expect(lintCommits(git, "perdido..a").results.map((r) => r.sha)).toEqual(["a"]);
    expect(lintCommits(git, "a").onlyTip).toBe(false);
  });

  it("un commit que no está es un error, no un pase", () => {
    expect(lintCommits(git, "nada").results[0]?.verdict.ok).toBe(false);
  });
});

describe("hooks con git de verdad", { timeout: 60_000 }, () => {
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

  function git(cwd: string, ...args: string[]): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  }

  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "star-hooks-"));
    dirs.push(dir);
    git(dir, "init", "--quiet", "-b", "develop");
    return dir;
  }

  it("instala los hooks como ejecutables en el índice y apunta git a la carpeta", () => {
    const dir = repo();
    mkdirSync(join(dir, ".githooks"));
    writeFileSync(join(dir, ".githooks", "pre-commit"), "#!/usr/bin/env sh\nexec bunx vp staged\n");
    writeFileSync(join(dir, ".githooks", "commit-msg"), "#!/usr/bin/env sh\n# la copia vieja\n");

    const before = inspectHooks(dir);
    expect(before.map((h) => h.state)).toEqual(["different", "missing"]);
    installHooks(dir, gitIn(dir), before);

    expect(inspectHooks(dir).map((h) => h.state)).toEqual(["same", "same"]);
    expect(git(dir, "config", "core.hooksPath")).toBe(".githooks");
    // 100755 aunque se corra en Windows, que no guarda el bit en el disco.
    expect(git(dir, "ls-files", "-s", ".githooks")).toMatch(
      /^100755 \S+ 0\t\.githooks\/commit-msg$/m,
    );
    expect(git(dir, "ls-files", "-s", ".githooks")).toMatch(
      /^100755 \S+ 0\t\.githooks\/pre-push$/m,
    );
    // Los hooks propios de la app no se tocan.
    expect(readFileSync(join(dir, ".githooks", "pre-commit"), "utf8")).toContain("vp staged");
  });

  it("en Windows apaga core.filemode, para que un `git add -A` no deshaga el bit", () => {
    const dir = repo();
    git(dir, "config", "core.filemode", "true");
    expect(installHooks(dir, gitIn(dir), inspectHooks(dir), "win32")).toEqual({
      fileModeOff: true,
    });
    expect(git(dir, "config", "core.filemode")).toBe("false");
    git(dir, "add", "-A");
    expect(git(dir, "ls-files", "-s", ".githooks/pre-push")).toMatch(/^100755 /);

    const other = repo();
    git(other, "config", "core.filemode", "true");
    expect(installHooks(other, gitIn(other), inspectHooks(other), "linux").fileModeOff).toBe(false);
    expect(git(other, "config", "core.filemode")).toBe("true");
  });

  it("un hook al día pero 644 en el índice queda ejecutable", () => {
    const dir = repo();
    mkdirSync(join(dir, ".githooks"));
    for (const name of ["commit-msg", "pre-push"] as const) {
      writeFileSync(join(dir, ".githooks", name), hookScript(name));
    }
    git(dir, "add", "--chmod=-x", ".githooks");
    installHooks(dir, gitIn(dir), inspectHooks(dir));
    expect(git(dir, "ls-files", "-s", ".githooks/commit-msg")).toMatch(/^100755 /);
  });

  it("un hook con CRLF de un checkout en Windows cuenta como al día", () => {
    const dir = repo();
    mkdirSync(join(dir, ".githooks"));
    writeFileSync(
      join(dir, ".githooks", "commit-msg"),
      hookScript("commit-msg").replace(/\n/g, "\r\n"),
    );
    expect(inspectHooks(dir)[0]?.state).toBe("same");
  });

  it("lintCommits lee los mensajes de git", () => {
    const dir = repo();
    writeFileSync(join(dir, "a"), "1");
    git(dir, "add", ".");
    git(dir, "commit", "--quiet", "-m", "chore: start");
    const base = git(dir, "rev-parse", "HEAD");
    writeFileSync(join(dir, "a"), "2");
    git(dir, "commit", "--quiet", "-am", "Fixed it.");
    writeFileSync(join(dir, "a"), "3");
    git(dir, "commit", "--quiet", "-am", "fix(a): write three");

    const results = lintCommits(gitIn(dir), `${base}..HEAD`).results;
    expect(results.map((r) => [r.subject, r.verdict.ok])).toEqual([
      ["fix(a): write three", true],
      ["Fixed it.", false],
    ]);
  });
});
