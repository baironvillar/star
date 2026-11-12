import type { Git } from "../git.ts";

/**
 * Un git de mentira con un repositorio en orden, para pisar sólo lo que cada
 * test necesita romper. Los pedidos (commit, push…) se anotan en `calls`.
 */
export function fakeGit(overrides: Partial<Git> = {}): Git & { calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name} ${args.flat().join(" ")}`.trim());
    };
  return {
    calls,
    branch: () => "develop",
    dirty: () => [],
    localTagExists: () => false,
    remoteTagExists: () => false,
    localBranchExists: () => false,
    remoteBranchExists: () => false,
    behind: () => 0,
    ahead: () => 0,
    fetch: () => true,
    headSubject: () => "",
    commitOf: () => null,
    commitMessage: () => null,
    commitsBetween: () => [],
    getConfig: () => null,
    setConfig: record("setConfig"),
    addExecutable: record("addExecutable"),
    indexModes: () => ({}),
    trackedMatching: () => [],
    hasCommits: () => true,
    isAncestor: () => true,
    rootCommit: () => null,
    commitFiles: (files, message) => {
      calls.push(`commitFiles ${files.map((x) => x.path).join(" ")} ${message}`);
      return "root";
    },
    setBranch: record("setBranch"),
    mergeNoFf: record("mergeNoFf"),
    switchCreate: record("switchCreate"),
    switchTo: record("switchTo"),
    pullFastForward: record("pullFastForward"),
    add: record("add"),
    commit: record("commit"),
    push: record("push"),
    tag: record("tag"),
    ...overrides,
  };
}
