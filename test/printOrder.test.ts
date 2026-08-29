import { describe, expect, it } from "vitest";
import { printOrderLines } from "../src/export/constructionPlan";
import { syncPropEntries } from "../src/core/propCatalog";
import { propFromRecipe } from "../src/core/propRecipe";
import { createDefaultProject, type Project, type SceneObject } from "../src/core/model";

/**
 * The plan already knows every banner the stall needs and exactly how big it
 * is. These pin that knowledge reaching the person who has to order it.
 */

function planWith(recipes: Record<string, unknown>[], placements: string[]): Project {
  const p = createDefaultProject();
  p.props = recipes.map((r, i) => propFromRecipe(r as never, `prop_p${i}`));
  p.catalogExtras = syncPropEntries(p.catalogExtras, p.props);
  placements.forEach((propId, i) => {
    p.objects.push({
      id: `o${i}`, kind: "table", assetId: `custom:${propId}`,
      x: 1 + i, z: 2, rotationDeg: 0, width: 0.5, depth: 0.5, height: 1,
      locked: false, hidden: false, surface: "floor", elevation: 0,
    } as SceneObject);
  });
  return p;
}

describe("print order sheet", () => {
  it("lists only what is actually placed", () => {
    // Designing a banner and never putting it anywhere is not an order.
    const p = planWith(
      [{ name: "展架", kind: "x展架" }, { name: "沒用到的海報", kind: "海報" }],
      ["prop_p0"],
    );
    const orders = printOrderLines(p);
    expect(orders.map((o) => o.name)).toEqual(["展架"]);
  });

  it("multiplies the spec quantity by how many are placed", () => {
    const p = planWith([{ name: "展架", kind: "x展架" }], ["prop_p0", "prop_p0", "prop_p0"]);
    expect(printOrderLines(p)[0].quantity).toBe(3);
  });

  it("keeps a large print run intact", () => {
    const p = planWith(
      [{ name: "傳單", kind: "海報", print: { standard: "A5", quantity: 500, sides: 2 } }],
      ["prop_p0"],
    );
    const line = printOrderLines(p)[0];
    expect(line.quantity).toBe(500);
    expect(line.spec).toContain("雙面");
    expect(line.spec).toContain("500 份");
  });

  it("gives the artwork canvas including bleed", () => {
    const p = planWith([{ name: "海報", kind: "海報", print: { standard: "A3" } }], ["prop_p0"]);
    // A3 is 297 × 420, plus 3 mm bleed each edge.
    expect(printOrderLines(p)[0].artboard).toContain("303 × 426");
  });

  it("leaves non-printed props out of the print list", () => {
    const p = planWith(
      [{ name: "抽獎箱", kind: "抽獎箱" }, { name: "展架", kind: "x展架" }],
      ["prop_p0", "prop_p1"],
    );
    expect(printOrderLines(p).map((o) => o.name)).toEqual(["展架"]);
  });

  it("ignores hidden objects", () => {
    const p = planWith([{ name: "展架", kind: "x展架" }], ["prop_p0"]);
    p.objects[0].hidden = true;
    expect(printOrderLines(p)).toEqual([]);
  });

  it("returns nothing for a plan with no props at all", () => {
    expect(printOrderLines(createDefaultProject())).toEqual([]);
  });

  it("sorts the biggest run first, because that is the long-lead item", () => {
    const p = planWith(
      [
        { name: "展架", kind: "x展架" },
        { name: "傳單", kind: "海報", print: { standard: "A5", quantity: 300 } },
      ],
      ["prop_p0", "prop_p1"],
    );
    expect(printOrderLines(p)[0].name).toBe("傳單");
  });
});
