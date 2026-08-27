import { describe, expect, it } from "vitest";
import {
  BOOTH_ASSET_IDS,
  BOOTH_CATALOG,
  BOOTH_ZONE_ROLE_IDS,
  boothCatalogExtras,
} from "../src/core/boothCatalog";
import { AssetCatalog, BUILTIN_CATALOG } from "../src/core/catalog";
import { catalogFromProject, migrateProject } from "../src/core/migrate";
import { boothVenuePreset, createProjectFromVenuePreset } from "../src/core/venues";
import type { ObjectKind } from "../src/core/model";

const EIGHT_KINDS: ObjectKind[] = [
  "computer", "door", "switch", "screen", "table", "chair", "mat", "regTable",
];

function resolveAll() {
  const catalog = new AssetCatalog(BOOTH_CATALOG);
  return BOOTH_ASSET_IDS.map((id) => {
    const entry = catalog.get(id);
    expect(entry, `catalog entry missing for ${id}`).toBeDefined();
    return entry!;
  });
}

describe("booth catalog", () => {
  it("offers 15 booth assets, all inside the original eight ObjectKinds", () => {
    const entries = resolveAll();
    expect(entries).toHaveLength(15);
    for (const e of entries) {
      expect(EIGHT_KINDS, `${e.id} uses an unknown kind`).toContain(e.kind);
    }
  });

  it("keeps every booth dimension positive and resizable", () => {
    for (const e of resolveAll()) {
      expect(e.dimensions.width).toBeGreaterThan(0);
      expect(e.dimensions.depth).toBeGreaterThan(0);
      expect(e.dimensions.height).toBeGreaterThan(0);
      expect(e.allowCustomSize, `${e.id} must stay resizable`).toBe(true);
    }
  });

  it("adds nothing to BUILTIN_CATALOG — classroom projects are untouched", () => {
    const builtinIds = new Set(BUILTIN_CATALOG.map((e) => e.id));
    for (const e of BOOTH_CATALOG) {
      expect(e.id.startsWith("custom:")).toBe(true);
      expect(builtinIds.has(e.id)).toBe(false);
    }
    expect(BUILTIN_CATALOG.some((e) => e.tags.includes("booth"))).toBe(false);
  });

  it("survives an export → import round trip with its catalogExtras intact", () => {
    const project = createProjectFromVenuePreset(boothVenuePreset(), "攤位");
    const before = boothCatalogExtras().map((e) => e.id).sort();
    expect((project.catalogExtras ?? []).map((e) => e.id).sort()).toEqual(before);

    const reloaded = migrateProject(JSON.parse(JSON.stringify(project)));
    expect((reloaded.catalogExtras ?? []).map((e) => e.id).sort()).toEqual(before);

    // And the reloaded project still resolves each booth object to a real entry
    // (not the "遺失素材" fallback).
    const catalog = catalogFromProject(reloaded);
    for (const o of reloaded.objects) {
      if (!o.assetId?.startsWith("custom:")) continue;
      expect(catalog.get(o.assetId), `${o.assetId} lost on reload`).toBeDefined();
    }
  });

  it("names a colour and an icon for each booth zone role", () => {
    expect(BOOTH_ZONE_ROLE_IDS).toHaveLength(7);
  });
});
