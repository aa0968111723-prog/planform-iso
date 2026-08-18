import { describe, expect, it } from "vitest";
import { planSymbolForEntry, planSymbolForKind, planSymbolForSemantic } from "../src/core/planSymbol";
import { AssetCatalog } from "../src/core/catalog";

describe("plan symbols", () => {
  it("labels check-in and payment desks distinctly", () => {
    const checkin = planSymbolForKind("regTable");
    expect(checkin.kind).toBe("checkin-desk");
    expect(checkin.icon).toBe("報到");

    const payment = planSymbolForSemantic("service-desk", "payment", "#c4a574");
    expect(payment.kind).toBe("payment-desk");
    expect(payment.icon).toBe("收費");
  });

  it("shows facing for chairs and signage", () => {
    expect(planSymbolForKind("chair").showFacing).toBe(true);
    expect(planSymbolForSemantic("signage").showFacing).toBe(true);
    expect(planSymbolForSemantic("storage").icon).toBe("收納");
  });

  it("derives symbols from catalog entries", () => {
    const entry = new AssetCatalog().get("builtin:payment-desk")!;
    const spec = planSymbolForEntry(entry);
    expect(spec.kind).toBe("payment-desk");
  });
});
