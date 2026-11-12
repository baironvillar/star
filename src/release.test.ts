import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { StarError } from "./errors.ts";
import type { Gh, PullRequest } from "./gh.ts";
import { gitIn } from "./git.ts";
import type { Manifest } from "./manifests/types.ts";
import { checkPrepare, finishRelease, prepareRelease, type ReleaseDeps } from "./release.ts";
import { fakeGit } from "./testing/fake-git.ts";
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

const ok = {
  entries: [entry("package.json", "0.1.0")],
  current: "0.1.0",
  next: "0.2.0",
  base: "develop",
  changelog: "## [Sin publicar]\n\n- Algo nuevo.\n",
  today: "2026-11-08",
  gate: ["vp check"],
  git: fakeGit(),
};

describe("checkPrepare", () => {
  it("en develop al día, con notas sin publicar: listo, y propone promoverlas", () => {
    const check = checkPrepare(ok);
    expect(check.problems).toEqual([]);
    expect(check.notes).toBe("- Algo nuevo.");
    expect(check.promoted).toContain("## [0.2.0] - 2026-11-08");
  });

  it("con la sección ya escrita no promueve nada", () => {
    const check = checkPrepare({ ...ok, changelog: "## [0.2.0]\n\n- Listo.\n" });
    expect(check.notes).toBe("- Listo.");
    expect(check.promoted).toBeNull();
  });

  it("deja pasar cambios en el CHANGELOG y archivos sin seguimiento, nada más", () => {
    const git = fakeGit({ dirty: () => [" M CHANGELOG.md", "?? notas.txt"] });
    expect(checkPrepare({ ...ok, git }).problems).toEqual([]);
    const dirty = fakeGit({ dirty: () => [" M CHANGELOG.md", " M src/app.ts"] });
    expect(checkPrepare({ ...ok, git: dirty }).problems.join()).toMatch(/src\/app\.ts/);
  });

  it("cada cosa fuera de lugar es un problema", () => {
    const git = fakeGit({
      branch: () => "feat/x",
      localTagExists: () => true,
      localBranchExists: () => true,
      remoteBranchExists: () => true,
    });
    const { problems } = checkPrepare({
      ...ok,
      changelog: "## [0.1.0]\n\n- Antes.\n",
      gate: null,
      git,
    });
    const text = problems.join("\n");
    expect(problems).toHaveLength(6);
    expect(text).toMatch(/sale de 'develop'/);
    expect(text).toMatch(/v0\.2\.0 ya existe/);
    expect(text).toMatch(/release\/0\.2\.0 ya existe\./);
    expect(text).toMatch(/ya existe en origin/);
    expect(text).toMatch(/CHANGELOG\.md no tiene notas/);
    expect(text).toMatch(/star.*gate/);
  });

  it("un develop con commits propios o atrasado no sirve de base", () => {
    const { problems } = checkPrepare({ ...ok, git: fakeGit({ ahead: () => 1, behind: () => 2 }) });
    expect(problems.join("\n")).toMatch(/no están en origin/);
    expect(problems.join("\n")).toMatch(/git pull/);
  });
});

/**
 * El flujo entero con git de verdad: un origin local, la rama, el squash y el
 * tag. GitHub es lo único que se reemplaza, por un doble.
 */
// Cada test hace decenas de llamadas a git, y en Windows cada una cuesta.
/** Un reloj que sólo avanza cuando se espera: los tests no esperan de verdad. */
function clock(): Pick<ReleaseDeps, "sleep" | "now"> {
  let t = 0;
  return {
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
  };
}

describe("prepareRelease y finishRelease con git", { timeout: 60_000 }, () => {
  let home: string;
  const saved: Record<string, string | undefined> = {};
  const isolate = {
    GIT_AUTHOR_NAME: "star",
    GIT_AUTHOR_EMAIL: "star@example.com",
    GIT_COMMITTER_NAME: "star",
    GIT_COMMITTER_EMAIL: "star@example.com",
  };

  beforeAll(() => {
    // La configuración global de quien corre los tests (hooks, firma) no entra.
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

  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  }

  function repo(): { work: string; origin: string } {
    const dir = mkdtempSync(join(tmpdir(), "star-release-"));
    dirs.push(dir);
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    git(dir, "init", "--quiet", "--bare", "-b", "develop", origin);
    mkdirSync(work);
    git(work, "init", "--quiet", "-b", "develop");
    git(work, "remote", "add", "origin", origin);
    writeFileSync(
      join(work, "package.json"),
      `{\n  "name": "app",\n  "version": "0.1.0",\n  "star": { "gate": [] }\n}\n`,
    );
    writeFileSync(
      join(work, "CHANGELOG.md"),
      "# Changelog\n\n## [Sin publicar]\n\n- Algo nuevo.\n",
    );
    git(work, "add", ".");
    git(work, "commit", "--quiet", "-m", "chore: start");
    git(work, "push", "--quiet", "-u", "origin", "develop");
    // Como lo deja `star init github`: main y develop desde el mismo commit.
    git(work, "push", "--quiet", "origin", "develop:main");
    return { work, origin };
  }

  function deps(work: string, pr: () => PullRequest | null, created: string[]): ReleaseDeps {
    const gh: Gh = {
      available: () => true,
      createPr: ({ head, title, body }) => {
        created.push(`${head} ${title} ${body}`);
        return "https://github.com/x/app/pull/7";
      },
      findPr: pr,
      viewPr: () => null,
      mergeSquash: () => {
        throw new Error("en este test el PR ya viene mergeado");
      },
      releaseAssets: () => [],
      downloadAsset: () => null,
      secretNames: () => [],
      setSecret: () => {},
      mergeSettings: () => null,
      updateMergeSettings: () => {},
    };
    return {
      root: work,
      git: gitIn(work),
      gh,
      runGate: () => true,
      today: () => "2026-11-08",
      ...clock(),
      io: { log: () => {}, warn: () => {}, confirm: async () => true },
    };
  }

  /** Lo que hace GitHub con Squash and merge: un commit nuevo en develop. */
  function squash(work: string, subject: string) {
    git(work, "switch", "--quiet", "develop");
    git(work, "merge", "--quiet", "--squash", "release/0.2.0");
    git(work, "commit", "--quiet", "-m", subject);
    git(work, "push", "--quiet", "origin", "develop");
    git(work, "switch", "--quiet", "release/0.2.0");
  }

  const merged = (): PullRequest => ({
    number: 7,
    url: "https://github.com/x/app/pull/7",
    state: "MERGED",
    checks: "passing",
    mergeable: null,
  });

  it("prepara la rama con el bump y las notas, y después etiqueta lo que llegó a develop", async () => {
    const { work, origin } = repo();
    const created: string[] = [];

    await prepareRelease(
      deps(work, () => null, created),
      "minor",
    );

    expect(git(work, "branch", "--show-current")).toBe("release/0.2.0");
    expect(git(work, "log", "-1", "--format=%s")).toBe("0.2.0");
    expect(git(origin, "branch", "--list", "release/0.2.0")).toContain("release/0.2.0");
    expect(readFileSync(join(work, "package.json"), "utf8")).toContain('"version": "0.2.0"');
    const changelog = readFileSync(join(work, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## [Sin publicar]\n\n## [0.2.0] - 2026-11-08\n\n- Algo nuevo.");
    expect(created).toEqual(["release/0.2.0 0.2.0 - Algo nuevo."]);

    squash(work, "0.2.0");
    await finishRelease(deps(work, merged, []));

    expect(git(work, "branch", "--show-current")).toBe("develop");
    expect(git(origin, "tag", "--list")).toBe("v0.2.0");
    expect(git(origin, "rev-list", "-n", "1", "v0.2.0")).toBe(git(origin, "rev-parse", "develop"));
    // main recibe la versión en un merge commit que se llama como ella, con
    // develop como segundo padre: ningún PR tuvo que hacer merge commit.
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("0.2.0");
    expect(git(origin, "rev-parse", "main^2")).toBe(git(origin, "rev-parse", "develop"));

    // Un segundo finish (uno que se cortó después del push a main) no duplica el merge.
    git(work, "push", "--quiet", "--delete", "origin", "v0.2.0");
    git(work, "tag", "-d", "v0.2.0");
    const before = git(origin, "rev-parse", "main");
    await finishRelease(deps(work, merged, []), "0.2.0");
    expect(git(origin, "rev-parse", "main")).toBe(before);
    expect(git(origin, "tag", "--list")).toBe("v0.2.0");
  });

  it("una beta copia las notas y las deja para la versión final", async () => {
    const { work, origin } = repo();
    await prepareRelease(
      deps(work, () => null, []),
      "minor",
      true,
    );
    expect(git(work, "branch", "--show-current")).toBe("release/0.2.0-beta.1");
    expect(git(work, "log", "-1", "--format=%s")).toBe("0.2.0-beta.1");
    const changelog = readFileSync(join(work, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(
      "## [Sin publicar]\n\n- Algo nuevo.\n\n## [0.2.0-beta.1] - 2026-11-08\n\n- Algo nuevo.",
    );

    // Mergeada y etiquetada como cualquier versión.
    git(work, "switch", "--quiet", "develop");
    git(work, "merge", "--quiet", "--squash", "release/0.2.0-beta.1");
    git(work, "commit", "--quiet", "-m", "0.2.0-beta.1");
    git(work, "push", "--quiet", "origin", "develop");
    git(work, "switch", "--quiet", "release/0.2.0-beta.1");
    await finishRelease(deps(work, merged, []));
    expect(git(origin, "tag", "--list")).toBe("v0.2.0-beta.1");
    // Una beta no llega a main.
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("chore: start");
  });

  it("no etiqueta un commit mergeado a mano con el número del PR en el asunto", async () => {
    const { work, origin } = repo();
    await prepareRelease(
      deps(work, () => null, []),
      "minor",
    );
    squash(work, "0.2.0 (#7)");

    await expect(finishRelease(deps(work, merged, []))).rejects.toThrow(
      /tendría que llamarse "0\.2\.0"/,
    );
    expect(git(origin, "tag", "--list")).toBe("");
  });

  it("no prepara nada si la puerta falla", async () => {
    const { work, origin } = repo();
    const failing = { ...deps(work, () => null, []), runGate: () => false };
    writeFileSync(
      join(work, "package.json"),
      `{\n  "name": "app",\n  "version": "0.1.0",\n  "star": { "gate": ["falla"] }\n}\n`,
    );
    git(work, "commit", "--quiet", "-am", "chore: gate");
    git(work, "push", "--quiet", "origin", "develop");

    await expect(prepareRelease(failing, "minor")).rejects.toThrow(StarError);
    expect(git(work, "branch", "--show-current")).toBe("develop");
    expect(git(origin, "branch", "--list", "release/*")).toBe("");
  });

  it("las notas recién escritas en el CHANGELOG viajan en el commit de la versión", async () => {
    const { work } = repo();
    // Sin commitear, y como único cambio: es la primera línea de `git status`.
    writeFileSync(join(work, "CHANGELOG.md"), "# Changelog\n\n## [0.2.0]\n\n- Recién escrito.\n");

    await prepareRelease(
      deps(work, () => null, []),
      "minor",
    );

    expect(git(work, "status", "--porcelain")).toBe("");
    expect(git(work, "show", "--format=", "--name-only", "HEAD").split("\n").sort()).toEqual([
      "CHANGELOG.md",
      "package.json",
    ]);
  });

  /** Un repo con esa clave "star", y un gh cuyo CI pasa después de esperar. */
  function autoRelease(star: object, answer: (question: string) => boolean) {
    const { work, origin } = repo();
    const pkg = { name: "app", version: "0.1.0", star: { gate: [], autoMerge: true, ...star } };
    writeFileSync(
      join(work, "package.json"),
      `${JSON.stringify(pkg, null, 2)}
`,
    );
    git(work, "commit", "--quiet", "-am", "chore: auto merge");
    git(work, "push", "--quiet", "origin", "develop");

    const states: PullRequest["checks"][] = ["none", "pending", "passing"];
    const merges: string[] = [];
    const confirms: string[] = [];
    const base = deps(work, () => null, []);
    const auto: ReleaseDeps = {
      ...base,
      io: { ...base.io, confirm: async (q) => (confirms.push(q), answer(q)) },
      gh: {
        ...base.gh,
        findPr: () => ({ ...merged(), state: "OPEN", checks: states.shift() ?? "passing" }),
        mergeSquash: (_number, subject) => {
          merges.push(subject);
          squash(work, subject);
        },
      },
    };
    return { work, origin, auto, merges, confirms };
  }

  it("con autoMerge, release espera el CI, mergea sola y pregunta antes de lanzar", async () => {
    const { origin, auto, merges, confirms } = autoRelease({}, () => true);

    await prepareRelease(auto, "minor");

    expect(merges).toEqual(["0.2.0"]);
    expect(confirms).toEqual(["¿Preparar la 0.2.0?", "¿Lanzar la 0.2.0?"]);
    expect(git(origin, "tag", "--list")).toBe("v0.2.0");
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("0.2.0");
  });

  it("si no se lanza, la versión queda en develop sin main ni tag, y finish retoma", async () => {
    const { work, origin, auto } = autoRelease({}, (q) => !q.startsWith("¿Lanzar"));

    await prepareRelease(auto, "minor");

    expect(git(origin, "log", "-1", "--format=%s", "develop")).toBe("0.2.0");
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("chore: start");
    expect(git(origin, "tag", "--list")).toBe("");

    // Más tarde, a mano: el PR ya está mergeado y la pregunta de terminar basta.
    await finishRelease(deps(work, merged, []), "0.2.0");
    expect(git(origin, "tag", "--list")).toBe("v0.2.0");
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("0.2.0");
  });

  it("con confirmRelease en false es 100% automático: se pregunta sólo al preparar", async () => {
    const { origin, auto, confirms } = autoRelease({ confirmRelease: false }, () => true);

    await prepareRelease(auto, "minor");

    expect(confirms).toEqual(["¿Preparar la 0.2.0?"]);
    expect(git(origin, "tag", "--list")).toBe("v0.2.0");
    expect(git(origin, "log", "-1", "--format=%s", "main")).toBe("0.2.0");
  });

  it("con autoMerge, un CI que falla no se mergea", async () => {
    const { work, origin } = repo();
    writeFileSync(
      join(work, "package.json"),
      `{
  "name": "app",
  "version": "0.1.0",
  "star": { "gate": [], "autoMerge": true }
}
`,
    );
    git(work, "commit", "--quiet", "-am", "chore: auto merge");
    git(work, "push", "--quiet", "origin", "develop");

    const states: PullRequest["checks"][] = ["pending", "failing"];
    const base = deps(work, () => null, []);
    const auto: ReleaseDeps = {
      ...base,
      gh: {
        ...base.gh,
        findPr: () => ({ ...merged(), state: "OPEN", checks: states.shift() ?? "failing" }),
      },
    };

    await expect(prepareRelease(auto, "minor")).rejects.toThrow(/el CI del PR #7 falló/);
    expect(git(origin, "tag", "--list")).toBe("");
  });

  it("finish frena si el CI del PR todavía corre", async () => {
    const { work } = repo();
    await prepareRelease(
      deps(work, () => null, []),
      "minor",
    );
    const running = (): PullRequest => ({ ...merged(), state: "OPEN", checks: "pending" });
    await expect(finishRelease(deps(work, running, []))).rejects.toThrow(/todavía corre/);
  });
});
