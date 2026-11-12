import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Gh, PullRequestDetail } from "./gh.ts";
import { mergePr, type PrDeps } from "./pr.ts";
import { fakeGit } from "./testing/fake-git.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function app(): string {
  const root = mkdtempSync(join(tmpdir(), "star-pr-"));
  dirs.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", star: { gate: [] } }));
  return root;
}

const pr = (over: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
  number: 12,
  url: "https://github.com/x/app/pull/12",
  state: "OPEN",
  checks: "passing",
  mergeable: true,
  title: "feat(pr): merge from star",
  body: "## What\n\nAlgo.",
  base: "develop",
  head: "feat/pr-merge",
  ...over,
});

/** Un gh cuyo PR pasa por esos estados, en orden, y repite el último. */
function setup(states: Partial<PullRequestDetail>[], branch = "feat/pr-merge") {
  let i = 0;
  const merges: string[] = [];
  const logs: string[] = [];
  const git = fakeGit({ branch: () => branch });
  const gh = {
    available: () => true,
    viewPr: () => pr(states[Math.min(i++, states.length - 1)]),
    mergeSquash: (n: number, subject: string, body?: string) => {
      merges.push(`#${n} ${subject} | ${body}`);
    },
  } as unknown as Gh;
  let t = 0;
  const deps: PrDeps = {
    root: app(),
    git,
    gh,
    io: { log: (m) => logs.push(m), warn: (m) => logs.push(`! ${m}`) },
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
  };
  return { deps, git, merges, logs };
}

describe("mergePr", () => {
  it("espera el CI, mergea con el título y la descripción, y te deja en la base", async () => {
    const { deps, git, merges } = setup([{ checks: "none" }, { checks: "pending" }, {}]);

    await mergePr(deps);

    expect(merges).toEqual(["#12 feat(pr): merge from star (#12) | ## What\n\nAlgo."]);
    expect(git.calls).toContain("switchTo develop");
    expect(git.calls).toContain("pullFastForward");
  });

  it("no mergea si el CI falla", async () => {
    const { deps, merges } = setup([{ checks: "pending" }, { checks: "failing" }]);
    await expect(mergePr(deps, "12")).rejects.toThrow(/el CI falló/);
    expect(merges).toEqual([]);
  });

  it("no mergea con conflictos", async () => {
    const { deps, merges } = setup([{ mergeable: false }]);
    await expect(mergePr(deps, "12")).rejects.toThrow(/conflictos con develop/);
    expect(merges).toEqual([]);
  });

  it("rechaza antes de esperar: un PR a main, uno de versión o un título fuera de la convención", async () => {
    for (const [over, message] of [
      [{ base: "main" }, /main no recibe pull requests/],
      [{ head: "release/0.8.0", title: "0.8.0" }, /release finish/],
      [{ title: "Update stuff" }, /no cumple la convención/],
    ] as const) {
      const { deps, merges } = setup([over]);
      await expect(mergePr(deps, "12")).rejects.toThrow(message);
      expect(merges).toEqual([]);
    }
  });

  it("un PR ya mergeado no es un error", async () => {
    const { deps, merges, logs } = setup([{ state: "MERGED" }]);
    await mergePr(deps, "12");
    expect(merges).toEqual([]);
    expect(logs).toContain("El PR #12 ya está mergeado.");
  });

  it("desde otra rama no te cambia de rama", async () => {
    const { deps, git } = setup([{}], "develop");
    await mergePr(deps, "12");
    expect(git.calls).not.toContain("switchTo develop");
  });
});
