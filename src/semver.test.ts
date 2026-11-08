import { describe, expect, it } from "vite-plus/test";
import { StarError } from "./errors.ts";
import { bump, formatVersion, parseVersion } from "./semver.ts";

const next = (v: string, level: "patch" | "minor" | "major") =>
  formatVersion(bump(parseVersion(v, "test"), level));

describe("parseVersion", () => {
  it("lee major.minor.patch y prereleases", () => {
    expect(parseVersion("1.2.3", "x")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion("1.2.3-rc.1", "x")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: "rc.1",
    });
  });

  it("rechaza lo que no es una versión, diciendo de dónde salió", () => {
    for (const raw of ["1.2", "v1.2.3", "01.2.3", "1.2.3+build", "latest"]) {
      expect(() => parseVersion(raw, "package.json")).toThrow(StarError);
    }
    expect(() => parseVersion("1.2", "package.json")).toThrow(/package\.json/);
  });
});

describe("bump", () => {
  it("sube cada nivel y reinicia los de abajo", () => {
    expect(next("1.2.3", "patch")).toBe("1.2.4");
    expect(next("1.2.3", "minor")).toBe("1.3.0");
    expect(next("1.2.3", "major")).toBe("2.0.0");
  });

  it("desde un prerelease sale la versión que anticipaba", () => {
    expect(next("1.2.3-rc.1", "patch")).toBe("1.2.3");
    expect(next("1.2.0-rc.1", "minor")).toBe("1.2.0");
    expect(next("1.2.3-rc.1", "minor")).toBe("1.3.0");
    expect(next("2.0.0-beta", "major")).toBe("2.0.0");
    expect(next("2.1.0-beta", "major")).toBe("3.0.0");
  });
});
