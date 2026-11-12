import { describe, expect, it } from "vite-plus/test";
import { StarError } from "./errors.ts";
import {
  assetForUrl,
  checkDesktopRelease,
  checkPublishedFiles,
  parsePlatforms,
  type ReleaseCheckInput,
} from "./updater.ts";

const tag = "v0.6.0";
const download = (name: string) =>
  `https://github.com/x/app/releases/download/${tag}/${encodeURIComponent(name)}`;
const assets = [
  { id: 1, name: "App_0.6.0_x64.msi" },
  { id: 2, name: "App_0.6.0_x64.msi.sig" },
  { id: 3, name: "App_0.6.0_amd64.AppImage" },
  { id: 4, name: "App_0.6.0_amd64.AppImage.sig" },
  { id: 5, name: "latest.json" },
];

const good: ReleaseCheckInput = {
  tag,
  notes: "- Algo nuevo.",
  platforms: ["windows", "linux"],
  assets,
  manifest: {
    version: "0.6.0",
    notes: "- Algo nuevo.\r\n",
    platforms: {
      "windows-x86_64": { url: download("App_0.6.0_x64.msi"), signature: "firma-msi" },
      "windows-x86_64-msi": { url: download("App_0.6.0_x64.msi"), signature: "firma-msi" },
      "linux-x86_64": { url: download("App_0.6.0_amd64.AppImage"), signature: "firma-appimage" },
    },
  },
  signatures: {
    "App_0.6.0_x64.msi.sig": "firma-msi\n",
    "App_0.6.0_amd64.AppImage.sig": "firma-appimage",
  },
};

describe("checkDesktopRelease", () => {
  it("una release armada por tauri-action v1 se puede publicar", () => {
    expect(checkDesktopRelease(good)).toEqual([]);
  });

  it("sin latest.json la app instalada no se entera", () => {
    expect(checkDesktopRelease({ ...good, manifest: null })[0]).toMatch(/no tiene latest\.json/);
  });

  it("cada cosa que falló alguna vez en Starless es un problema", () => {
    const problems = checkDesktopRelease({
      ...good,
      manifest: {
        version: "0.5.9",
        notes: "otras",
        platforms: {
          "windows-x86_64-msi": { url: download("App_0.6.0_x64_en-US.msi"), signature: "x" },
          "linux-x86_64": { url: download("App_0.6.0_amd64.AppImage"), signature: "otra" },
        },
      },
    }).join("\n");
    expect(problems).toMatch(/dice la versión 0\.5\.9/);
    expect(problems).toMatch(/notas de latest\.json no son las del CHANGELOG/);
    expect(problems).toMatch(/no tiene la clave windows-x86_64$/m);
    expect(problems).toMatch(/windows-x86_64-msi apunta a un archivo que no está/);
    expect(problems).toMatch(/linux-x86_64: la firma de latest\.json no es la de/);
  });

  it("un instalador sin su .sig no se puede verificar", () => {
    const problems = checkDesktopRelease({ ...good, signatures: {} });
    expect(problems.join("\n")).toMatch(/falta App_0\.6\.0_x64\.msi\.sig/);
  });

  it("sólo exige las plataformas que se publican", () => {
    const windowsOnly = { ...good, platforms: ["windows"] as const };
    const { "linux-x86_64": _, ...rest } = good.manifest?.platforms ?? {};
    expect(
      checkDesktopRelease({ ...windowsOnly, manifest: { ...good.manifest, platforms: rest } }),
    ).toEqual([]);
  });
});

describe("assetForUrl", () => {
  it("acepta la URL de tauri-action v1 y la de antes, por id", () => {
    expect(assetForUrl(download("App_0.6.0_x64.msi"), tag, assets)?.id).toBe(1);
    expect(
      assetForUrl("https://api.github.com/repos/x/app/releases/assets/3", tag, assets)?.name,
    ).toBe("App_0.6.0_amd64.AppImage");
    expect(assetForUrl(download("App_0.6.0_x64.msi"), "v0.5.0", assets)).toBeUndefined();
  });
});

describe("checkPublishedFiles", () => {
  it("baja latest.json y las firmas de la release y las revisa", () => {
    const files: Record<string, string> = {
      "latest.json": JSON.stringify(good.manifest),
      ...good.signatures,
    };
    const gh = {
      releaseAssets: () => assets,
      downloadAsset: (_: string, n: string) => files[n] ?? null,
    };
    expect(checkPublishedFiles(gh, { tag, notes: good.notes, platforms: good.platforms })).toEqual(
      [],
    );
  });

  it("un latest.json roto se dice como tal", () => {
    const gh = { releaseAssets: () => assets, downloadAsset: () => "{no" };
    expect(checkPublishedFiles(gh, { tag, notes: "", platforms: ["windows"] })).toEqual([
      "latest.json no es JSON válido",
    ]);
  });
});

describe("parsePlatforms", () => {
  it("windows y linux; macOS se dice que todavía no", () => {
    expect(parsePlatforms("windows, Linux")).toEqual(["windows", "linux"]);
    expect(() => parsePlatforms("macos")).toThrow(StarError);
    expect(() => parsePlatforms("macos")).toThrow(/todavía no/);
    expect(() => parsePlatforms("android")).toThrow(/no es una plataforma/);
  });
});
