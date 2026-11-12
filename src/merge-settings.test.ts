import { describe, expect, it } from "vite-plus/test";
import { parseMergeSettings } from "./gh.ts";
import {
  configureMerge,
  mergeChanges,
  mergePatch,
  type MergeSettings,
  wanted,
} from "./merge-settings.ts";

/** Lo que trae un repo recién creado en GitHub. */
const GITHUB_DEFAULTS: MergeSettings = {
  allowSquash: true,
  squashTitle: "COMMIT_OR_PR_TITLE",
  squashMessage: "COMMIT_MESSAGES",
  allowMergeCommit: true,
  allowRebase: true,
  defaultBranch: "main",
};

/** Lo que dejaba la 0.6.0: el squash bien, el resto como venía. */
const AFTER_0_6: MergeSettings = {
  ...GITHUB_DEFAULTS,
  squashTitle: "PR_TITLE",
  squashMessage: "PR_BODY",
};

describe("mergeChanges", () => {
  it("lo de GitHub por defecto: sólo squash, desde el PR, y la base por defecto", () => {
    const changes = mergeChanges(GITHUB_DEFAULTS, "develop");
    expect(changes.map((c) => c.description)).toEqual([
      "asunto del squash: el commit si hay uno solo, si no el título del PR → el título del PR",
      "cuerpo del squash: la lista de mensajes de los commits → la descripción del PR",
      "merge commit: habilitado → deshabilitado",
      "rebase and merge: habilitado → deshabilitado",
      "rama por defecto: main → develop",
    ]);
    expect(mergePatch(changes)).toEqual({
      squash_merge_commit_title: "PR_TITLE",
      squash_merge_commit_message: "PR_BODY",
      allow_merge_commit: false,
      allow_rebase_merge: false,
      default_branch: "develop",
    });
  });

  it("un repo que pasó por la 0.6.0: el merge commit seguía siendo el botón por defecto (sme)", () => {
    expect(mergeChanges(AFTER_0_6, "develop").map((c) => c.field)).toEqual([
      "allow_merge_commit",
      "allow_rebase_merge",
      "default_branch",
    ]);
  });

  it("con squash deshabilitado también lo habilita, como booleano", () => {
    const patch = mergePatch(mergeChanges({ ...wanted("develop"), allowSquash: false }, "develop"));
    expect(patch).toEqual({ allow_squash_merge: true });
  });

  it("si ya está, no hay nada que cambiar", () => {
    expect(mergeChanges(wanted("develop"), "develop")).toEqual([]);
  });
});

describe("parseMergeSettings", () => {
  const repo = {
    allow_squash_merge: true,
    squash_merge_commit_title: "COMMIT_OR_PR_TITLE",
    squash_merge_commit_message: "COMMIT_MESSAGES",
    allow_merge_commit: true,
    allow_rebase_merge: true,
  };

  it("lee los campos de GET /repos/{owner}/{repo}", () => {
    expect(parseMergeSettings(JSON.stringify({ ...repo, default_branch: "main" }))).toEqual(
      GITHUB_DEFAULTS,
    );
  });

  it("un repo vacío no tiene rama por defecto todavía", () => {
    expect(parseMergeSettings(JSON.stringify(repo))?.defaultBranch).toBe("");
  });

  it("sin permiso de escritura GitHub omite los campos: es null, no un valor", () => {
    expect(parseMergeSettings(JSON.stringify({ allow_squash_merge: true }))).toBeNull();
    expect(parseMergeSettings("")).toBeNull();
  });
});

function fakeGh(initial: MergeSettings | null, saves = true) {
  let settings = initial;
  const patches: Record<string, string | boolean>[] = [];
  return {
    patches,
    mergeSettings: () => settings,
    updateMergeSettings(fields: Record<string, string | boolean>) {
      patches.push(fields);
      if (saves && settings) settings = wanted("develop");
    },
  };
}

describe("configureMerge", () => {
  it("pregunta, escribe sólo lo que cambia y lo vuelve a leer", async () => {
    const gh = fakeGh(AFTER_0_6);
    const asked: string[][] = [];
    const result = await configureMerge(gh, "develop", async (changes) => {
      asked.push(changes.map((c) => c.field));
      return true;
    });
    expect(result.action).toBe("applied");
    expect(asked).toEqual([["allow_merge_commit", "allow_rebase_merge", "default_branch"]]);
    expect(gh.patches).toEqual([
      { allow_merge_commit: false, allow_rebase_merge: false, default_branch: "develop" },
    ]);
  });

  it("si la respuesta es no, no toca nada", async () => {
    const gh = fakeGh(GITHUB_DEFAULTS);
    const result = await configureMerge(gh, "develop", async () => false);
    expect(result.action).toBe("declined");
    expect(gh.patches).toEqual([]);
  });

  it("si ya está, ni pregunta", async () => {
    const gh = fakeGh(wanted("develop"));
    const result = await configureMerge(gh, "develop", async () => {
      throw new Error("no debería preguntar");
    });
    expect(result.action).toBe("ready");
  });

  it("sin poder leer los ajustes, no escribe a ciegas", async () => {
    const gh = fakeGh(null);
    expect((await configureMerge(gh, "develop", async () => true)).action).toBe("unreadable");
    expect(gh.patches).toEqual([]);
  });

  it("un PATCH que GitHub acepta pero no guarda no se da por bueno", async () => {
    const gh = fakeGh(GITHUB_DEFAULTS, false);
    await expect(configureMerge(gh, "develop", async () => true)).rejects.toThrow(
      /GitHub no guardó/,
    );
  });
});
