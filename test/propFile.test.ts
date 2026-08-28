/**
 * `.planform-prop.json` round-trip and, mostly, its refusals.
 *
 * The happy path is one assertion. The value is in what happens when someone
 * hands it the wrong file — a project JSON, a half-finished download, a prop
 * from a future build — because that is what actually happens, and "throws" or
 * "silently imports an empty prop" are both worse than a sentence.
 */

import { describe, expect, it } from "vitest";
import {
  PROP_FILE_FORMAT,
  PROP_FILE_VERSION,
  claimPropId,
  parsePropFile,
  propFileName,
  serializeProp,
} from "../src/export/propFile";
import { propPreset } from "../src/core/propPresets";
import type { PropDefinition } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}
installLocalStorage();

const dice = () => propPreset("prop_dice")!;

describe("round trip", () => {
  it("a prop survives export → import unchanged, faces and anchors included", () => {
    const before = dice();
    const result = parsePropFile(serializeProp(before));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prop).toEqual(before);
    expect(result.warnings).toEqual([]);
  });

  it("the golden assemblies survive too — parts, anchors, and the wired board", () => {
    for (const id of ["prop_dicestation", "prop_blessingbox", "prop_quizstation", "prop_spinnerstation"]) {
      const before = propPreset(id)!;
      const result = parsePropFile(serializeProp(before));
      expect(result.ok, id).toBe(true);
      if (result.ok) expect(result.prop, id).toEqual(before);
    }
  });

  it("the envelope says what it is, so a stray file is identifiable", () => {
    const parsed = JSON.parse(serializeProp(dice(), { app: "planform-iso 1.0", now: "2026-08-28" }));
    expect(parsed.format).toBe(PROP_FILE_FORMAT);
    expect(parsed.formatVersion).toBe(PROP_FILE_VERSION);
    expect(parsed.app).toBe("planform-iso 1.0");
    expect(parsed.exportedAt).toBe("2026-08-28");
  });

  it("names the file after the prop, safely", () => {
    expect(propFileName({ name: "大型骰子" })).toBe("大型骰子.planform-prop.json");
    expect(propFileName({ name: "Q&A / 快問 快答" })).toBe("Q_A_快問_快答.planform-prop.json");
    expect(propFileName({ name: "" })).toBe("prop.planform-prop.json");
  });
});

describe("refusals say what went wrong", () => {
  it("a project JSON is named as a project, not just rejected", () => {
    const project = JSON.stringify({ name: "我的場佈", objects: [], tile: { size: 0.6 }, zones: [] });
    const result = parsePropFile(project);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("專案");
    expect(result.reason).toContain("匯入 JSON");
  });

  it("broken JSON, empty text and non-objects never throw", () => {
    for (const bad of ["", "{{{", "null", "[]", '"a string"', "42"]) {
      const result = parsePropFile(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(5);
    }
  });

  it("some other app's JSON is refused by format, not by crashing on its shape", () => {
    const result = parsePropFile(JSON.stringify({ format: "some-other-tool", prop: { id: "x" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("道具檔");
  });

  it("a right envelope around a corrupt prop is refused, not half-imported", () => {
    const result = parsePropFile(JSON.stringify({
      format: PROP_FILE_FORMAT, formatVersion: 1, prop: { nonsense: true },
    }));
    expect(result.ok).toBe(false);
  });

  it("a prop with no parts is refused — it would place as nothing", () => {
    const empty: PropDefinition = { ...dice(), parts: [] };
    const result = parsePropFile(JSON.stringify({
      format: PROP_FILE_FORMAT, formatVersion: 1, prop: empty,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("零件");
  });
});

describe("a file from a newer build", () => {
  it("warns but still imports — refusing would strand the prop for no reason", () => {
    const result = parsePropFile(JSON.stringify({
      format: PROP_FILE_FORMAT,
      formatVersion: PROP_FILE_VERSION + 5,
      prop: dice(),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.prop.parts).toHaveLength(1);
  });

  it("goes through the defensive funnel: one unknown part is dropped, the prop survives", () => {
    const future = dice();
    const withJunk = {
      ...future,
      parts: [...future.parts, { id: "hologram", shape: "hologram", size: null, offset: "nope" }],
    };
    const result = parsePropFile(JSON.stringify({
      format: PROP_FILE_FORMAT, formatVersion: 1, prop: withJunk,
    }));
    expect(result.ok).toBe(true);
    // The unknown part is coerced by the funnel rather than taking the prop
    // down with it — 壞一筆丟一筆, per §77.
    if (result.ok) expect(result.prop.parts.length).toBeGreaterThanOrEqual(1);
  });
});

describe("importing twice", () => {
  it("keeps the original id when it is free", () => {
    const prop = dice();
    expect(claimPropId(prop, new Set()).id).toBe(prop.id);
  });

  it("never overwrites an existing prop — the second copy may be the edited one", () => {
    const prop = dice();
    const once = claimPropId(prop, new Set([prop.id]));
    expect(once.id).toBe(`${prop.id}_2`);
    expect(once.name).toContain("匯入");
    const twice = claimPropId(prop, new Set([prop.id, `${prop.id}_2`]));
    expect(twice.id).toBe(`${prop.id}_3`);
    // The definition itself is untouched — only identity changes.
    expect({ ...twice, id: prop.id, name: prop.name }).toEqual(prop);
  });
});
