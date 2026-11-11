import { describe, expect, it } from "vite-plus/test";
import { parseMergeSettings } from "./gh.ts";
import {
  configureMerge,
  mergeChanges,
  mergePatch,
  type MergeSettings,
  WANTED,
} from "./merge-settings.ts";

const GITHUB_DEFAULTS: MergeSettings = {
  allowSquash: true,
  squashTitle: "COMMIT_OR_PR_TITLE",
  squashMessage: "COMMIT_MESSAGES",
};

describe("mergeChanges", () => {
  it("lo de GitHub por defecto: asunto y cuerpo salen del PR", () => {
    const changes = mergeChanges(GITHUB_DEFAULTS);
    expect(changes.map((c) => c.description)).toEqual([
      "asunto del squash: el commit si hay uno solo, si no el título del PR → el título del PR",
      "cuerpo del squash: la lista de mensajes de los commits → la descripción del PR",
    ]);
    expect(mergePatch(changes)).toEqual({
      squash_merge_commit_title: "PR_TITLE",
      squash_merge_commit_message: "PR_BODY",
    });
  });

  it("con squash deshabilitado también lo habilita, como booleano", () => {
    const patch = mergePatch(mergeChanges({ ...WANTED, allowSquash: false }));
    expect(patch).toEqual({ allow_squash_merge: true });
  });

  it("si ya está, no hay nada que cambiar", () => {
    expect(mergeChanges(WANTED)).toEqual([]);
  });
});

describe("parseMergeSettings", () => {
  it("lee los campos de GET /repos/{owner}/{repo}", () => {
    const json = JSON.stringify({
      allow_squash_merge: true,
      squash_merge_commit_title: "COMMIT_OR_PR_TITLE",
      squash_merge_commit_message: "COMMIT_MESSAGES",
      allow_merge_commit: true,
    });
    expect(parseMergeSettings(json)).toEqual(GITHUB_DEFAULTS);
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
      if (saves && settings) settings = { ...WANTED };
    },
  };
}

describe("configureMerge", () => {
  it("pregunta, escribe sólo lo que cambia y lo vuelve a leer", async () => {
    const gh = fakeGh(GITHUB_DEFAULTS);
    const asked: string[][] = [];
    const result = await configureMerge(gh, async (changes) => {
      asked.push(changes.map((c) => c.field));
      return true;
    });
    expect(result.action).toBe("applied");
    expect(asked).toEqual([["squash_merge_commit_title", "squash_merge_commit_message"]]);
    expect(gh.patches).toEqual([
      { squash_merge_commit_title: "PR_TITLE", squash_merge_commit_message: "PR_BODY" },
    ]);
  });

  it("si la respuesta es no, no toca nada", async () => {
    const gh = fakeGh(GITHUB_DEFAULTS);
    const result = await configureMerge(gh, async () => false);
    expect(result.action).toBe("declined");
    expect(gh.patches).toEqual([]);
  });

  it("si ya está, ni pregunta", async () => {
    const gh = fakeGh(WANTED);
    const result = await configureMerge(gh, async () => {
      throw new Error("no debería preguntar");
    });
    expect(result.action).toBe("ready");
  });

  it("sin poder leer los ajustes, no escribe a ciegas", async () => {
    const gh = fakeGh(null);
    expect((await configureMerge(gh, async () => true)).action).toBe("unreadable");
    expect(gh.patches).toEqual([]);
  });

  it("un PATCH que GitHub acepta pero no guarda no se da por bueno", async () => {
    const gh = fakeGh(GITHUB_DEFAULTS, false);
    await expect(configureMerge(gh, async () => true)).rejects.toThrow(/GitHub no guardó/);
  });
});
