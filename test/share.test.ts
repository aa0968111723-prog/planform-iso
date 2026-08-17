import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../src/core/model";
import { decodeProject, encodeProject, readSharedFromHash } from "../src/share/share";

describe("project encode/decode", () => {
  it("round-trips a project (incl. CJK) through a URL-safe payload", () => {
    const p = createDefaultProject();
    p.name = "示範教室 🏫";
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
    // URL-safe: no characters that need escaping in a URL.
    expect(encoded).not.toMatch(/[^A-Za-z0-9+\-$]/);
    expect(decodeProject(encoded)).toEqual(p);
  });

  it("compresses repetitive plans smaller than raw JSON", () => {
    const p = createDefaultProject();
    for (let i = 0; i < 30; i++) {
      p.objects.push({
        id: `m${i}`, kind: "mat", x: i, z: 0, rotationDeg: 0,
        width: 0.6, depth: 1.8, height: 0.05, locked: false, hidden: false,
      });
    }
    const encoded = encodeProject(p);
    expect(encoded.length).toBeLessThan(JSON.stringify(p).length);
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
