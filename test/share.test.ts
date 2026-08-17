import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../src/core/model";
import {
  base64ToUtf8,
  decodeProject,
  encodeProject,
  readSharedFromHash,
  utf8ToBase64,
} from "../src/share/share";

describe("base64 utf-8 round-trip", () => {
  it("handles CJK text", () => {
    const s = "教室 / 走廊 平面圖 🏫";
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s);
  });
});

describe("project encode/decode", () => {
  it("round-trips a project through a URL-safe payload", () => {
    const p = createDefaultProject();
    p.name = "示範教室";
    p.zones.push({
      id: "z1",
      type: "registration",
      name: "報到區",
      x: 1,
      z: 2,
      width: 2,
      depth: 1.5,
      color: "#38bdf8",
      locked: false,
      hidden: false,
    });
    const encoded = encodeProject(p);
    // URL-safe: no +, /, or = padding.
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeProject(encoded)).toEqual(p);
  });

  it("returns null for garbage", () => {
    expect(decodeProject("!!!not-valid!!!")).toBeNull();
  });
});

describe("hash reader", () => {
  it("reads a plan from a #p= hash", () => {
    const p = createDefaultProject();
    p.name = "從連結載入";
    const hash = `#p=${encodeProject(p)}`;
    expect(readSharedFromHash(hash)?.name).toBe("從連結載入");
  });

  it("ignores unrelated hashes", () => {
    expect(readSharedFromHash("#other")).toBeNull();
    expect(readSharedFromHash("")).toBeNull();
  });
});
