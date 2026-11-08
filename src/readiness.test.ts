import { describe, expect, it } from "vite-plus/test";
import type { Git } from "./git.ts";
import type { Manifest } from "./manifests/types.ts";
import { checkReady } from "./readiness.ts";
import type { Entry } from "./version.ts";

function entry(label: string, version: string): Entry {
  const manifest: Manifest = {
    path: `/app/${label}`,
    label,
    read: () => ({ version }),
    write: (text) => text,
  };
  return { manifest, text: "", state: { version } };
}

const ready: Git = {
  branch: () => "release/0.2.0",
  dirty: () => [],
  localTagExists: () => false,
  remoteTagExists: () => false,
  behind: () => 0,
};

const base = {
  entries: [entry("package.json", "0.1.0"), entry("apps/web/package.json", "0.1.0")],
  current: "0.1.0",
  next: "0.2.0",
  changelog: "## [0.2.0]\n\n- Algo nuevo.\n",
  git: ready,
};

describe("checkReady", () => {
  it("todo en orden: sin problemas ni avisos", () => {
    expect(checkReady(base)).toEqual({ problems: [], warnings: [] });
  });

  it("cada cosa fuera de lugar es un problema", () => {
    const { problems } = checkReady({
      ...base,
      entries: [entry("package.json", "0.1.0"), entry("apps/web/package.json", "0.0.9")],
      changelog: "## [0.1.0]\n\n- Lo anterior.\n",
      git: {
        branch: () => "develop",
        dirty: () => [" M package.json"],
        localTagExists: () => true,
        remoteTagExists: () => false,
        behind: () => 0,
      },
    });
    expect(problems).toHaveLength(5);
    expect(problems.join("\n")).toMatch(/apps\/web\/package\.json dice 0\.0\.9/);
    expect(problems.join("\n")).toMatch(/release\/0\.2\.0/);
    expect(problems.join("\n")).toMatch(/v0\.2\.0 ya existe/);
    expect(problems.join("\n")).toMatch(/sin commitear/);
    expect(problems.join("\n")).toMatch(/CHANGELOG\.md/);
  });

  it("un tag que sólo existe en origin también frena", () => {
    const { problems } = checkReady({ ...base, git: { ...ready, remoteTagExists: () => true } });
    expect(problems).toEqual([expect.stringMatching(/ya existe en origin/)]);
  });

  it("no poder preguntar al remoto o ir atrasado es un aviso, no un problema", () => {
    const result = checkReady({
      ...base,
      git: { ...ready, remoteTagExists: () => null, behind: () => 3 },
    });
    expect(result.problems).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });
});
