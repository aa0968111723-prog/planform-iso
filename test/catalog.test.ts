import { describe, expect, it } from "vitest";
import {
  AssetCatalog,
  BUILTIN_CATALOG,
  BUILTIN_PREFIX,
  kindForSemantic,
  missingVisualFallback,
} from "../src/core/catalog";
import { ALL_KINDS } from "../src/core/assets";
import { migrateProject } from "../src/core/migrate";
import { PROJECT_VERSION, type Project } from "../src/core/model";

describe("asset catalog", () => {
  it("includes builtins for every ObjectKind plus service variants", () => {
    for (const kind of ALL_KINDS) {
      const id = `${BUILTIN_PREFIX}${kind}`;
      expect(BUILTIN_CATALOG.some((e) => e.id === id)).toBe(true);
    }
    expect(BUILTIN_CATALOG.some((e) => e.id === "builtin:payment-desk")).toBe(true);
    expect(BUILTIN_CATALOG.some((e) => e.id === "builtin:signage-stand")).toBe(true);
    expect(BUILTIN_CATALOG.some((e) => e.id === "builtin:shoe-rack")).toBe(true);
    expect(BUILTIN_CATALOG.some((e) => e.id === "builtin:av-mixer")).toBe(true);
    expect(BUILTIN_CATALOG.some((e) => e.id === "builtin:name-badge-box")).toBe(true);
  });

  it("resolves assetId over kind and falls back when missing", () => {
    const catalog = new AssetCatalog();
    const payment = catalog.get("builtin:payment-desk")!;
    expect(payment.serviceRole).toBe("payment");
    expect(payment.kind).toBe("table");

    const missing = catalog.resolve("custom:gone", "chair");
    expect(missing.id).toBe("builtin:chair");
  });

  it("supports custom entries without overwriting builtins", () => {
    const catalog = new AssetCatalog();
    catalog.upsert({
      id: "custom:my-table",
      name: "我家桌子",
      semanticType: "table",
      sourceType: "simple-proxy",
      category: "custom",
      placementType: "floor",
      dimensions: { width: 1.8, depth: 0.6, height: 0.74 },
      defaultFacingDeg: 0,
      clearanceFront: 0,
      blocksFlow: true,
      serviceRole: "payment",
      kind: "table",
      icon: "📦",
      color: "#888888",
      visualRef: "proxy:custom:my-table",
      tags: ["custom"],
      createdBy: "photo",
      version: 1,
    });
    expect(catalog.get("custom:my-table")?.name).toBe("我家桌子");
    expect(() =>
      catalog.upsert({
        ...catalog.get("builtin:table")!,
        name: "hack",
      }),
    ).toThrow();
  });

  it("maps semantic types to ObjectKind buckets", () => {
    expect(kindForSemantic("service-desk", "checkin")).toBe("regTable");
    expect(kindForSemantic("service-desk", "payment")).toBe("table");
    expect(kindForSemantic("payment-equipment")).toBe("computer");
    expect(kindForSemantic("signage")).toBe("table");
  });

  it("builds a missing-visual fallback", () => {
    const fb = missingVisualFallback({
      name: "遺失",
      dimensions: { width: 1, depth: 1, height: 1 },
      color: "#111",
    });
    expect(fb.sourceType).toBe("simple-proxy");
    expect(fb.visualRef).toBe("proxy:missing");
  });
});

describe("v3 → v4 catalog migration", () => {
  it("assigns builtin assetId and preserves objects", () => {
    const v3 = {
      version: 3,
      name: "舊圖",
      objects: [
        {
          id: "o1",
          kind: "table",
          x: 2,
          z: 2,
          rotationDeg: 0,
          width: 1.2,
          depth: 0.6,
          height: 0.74,
          locked: false,
          hidden: false,
          surface: "floor",
          elevation: 0,
        },
        {
          id: "o2",
          kind: "regTable",
          x: 1,
          z: 1,
          rotationDeg: 0,
          width: 1.5,
          depth: 0.7,
          height: 0.74,
          locked: false,
          hidden: false,
          surface: "floor",
          elevation: 0,
        },
      ],
    };
    const p = migrateProject(v3 as never);
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.objects).toHaveLength(2);
    expect(p.objects[0].assetId).toBe("builtin:table");
    expect(p.objects[1].assetId).toBe("builtin:regTable");
    expect(p.objects[1].serviceRole).toBe("checkin");
    expect(Array.isArray(p.catalogExtras)).toBe(true);
  });

  it("roundtrips custom catalog extras in project JSON", () => {
    const p = migrateProject({
      version: 4,
      catalogExtras: [
        {
          id: "custom:desk",
          name: "收費桌自訂",
          semanticType: "service-desk",
          sourceType: "simple-proxy",
          category: "custom",
          placementType: "floor",
          dimensions: { width: 1.5, depth: 0.7, height: 0.74 },
          defaultFacingDeg: 0,
          clearanceFront: 0.5,
          blocksFlow: true,
          serviceRole: "payment",
          kind: "table",
          icon: "💳",
          color: "#c4a574",
          visualRef: "proxy:custom:desk",
          tags: ["custom", "payment"],
          createdBy: "photo",
          version: 1,
          blobIds: { sourceImage: "img_1" },
        },
      ],
      objects: [
        {
          id: "o1",
          kind: "table",
          assetId: "custom:desk",
          serviceRole: "payment",
          x: 0,
          z: 0,
          rotationDeg: 0,
          width: 1.5,
          depth: 0.7,
          height: 0.74,
          locked: false,
          hidden: false,
          surface: "floor",
          elevation: 0,
        },
      ],
    } as Partial<Project>);
    expect(p.catalogExtras).toHaveLength(1);
    expect(p.catalogExtras![0].blobIds?.sourceImage).toBe("img_1");
    const again = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(again.objects[0].assetId).toBe("custom:desk");
    expect(again.catalogExtras![0].name).toBe("收費桌自訂");
  });
});
