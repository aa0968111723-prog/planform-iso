import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  DEFAULT_THEME,
  EXPORT_PALETTE,
  SCENE_PALETTE,
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  isThemeName,
  loadTheme,
  otherTheme,
  saveTheme,
  scenePalette,
} from "../src/core/theme";

function stubStorage(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

describe("theme defaults", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to light — the editor should look like the plan you send", () => {
    expect(DEFAULT_THEME).toBe("light");
  });

  it("light palette matches the exporter's paper colours", () => {
    // Editor / simulation / partner / export must be one visual language:
    // white classroom, light-slate secondary area, slate ink.
    expect(SCENE_PALETTE.light.floorClassroom).toBe(0xffffff);
    expect(SCENE_PALETTE.light.floorCorridor).toBe(0xf1f5f9);
    expect(SCENE_PALETTE.light.wallClassroom).toBe(0x334155);
  });

  it("export always uses the paper palette, never the dark canvas", () => {
    expect(EXPORT_PALETTE).toBe(SCENE_PALETTE.light);
    expect(EXPORT_PALETTE.background).not.toBe(SCENE_PALETTE.dark.background);
  });

  it("dark keeps the original canvas colours", () => {
    expect(SCENE_PALETTE.dark.background).toBe(0x0b1120);
  });

  it("scenePalette falls back to light for an unknown name", () => {
    expect(scenePalette("nope" as never)).toBe(SCENE_PALETTE.light);
  });

  it("otherTheme flips both ways", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });

  it("isThemeName only accepts the two supported looks", () => {
    expect(isThemeName("light")).toBe(true);
    expect(isThemeName("dark")).toBe(true);
    expect(isThemeName("solarized")).toBe(false);
    expect(isThemeName(null)).toBe(false);
  });
});

describe("theme persistence", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a stored preference", () => {
    const store = stubStorage();
    saveTheme("dark");
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(loadTheme()).toBe("dark");
  });

  it("ignores a corrupt stored value instead of painting an unknown theme", () => {
    const store = stubStorage();
    store.set(THEME_STORAGE_KEY, "neon");
    expect(loadTheme()).toBe("light");
  });

  it("survives storage being blocked (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadTheme()).toBe("light");
    expect(() => saveTheme("dark")).not.toThrow();
  });
});

describe("applyThemeToDocument", () => {
  it("stamps the root so the CSS tokens switch", () => {
    const root = { setAttribute: vi.fn(), style: { colorScheme: "" } };
    vi.stubGlobal("document", { documentElement: root });
    applyThemeToDocument("dark");
    expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "dark");
    expect(root.style.colorScheme).toBe("dark");
    vi.unstubAllGlobals();
  });
});
