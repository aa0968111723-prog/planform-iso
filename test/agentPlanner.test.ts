import { describe, expect, it } from "vitest";
import { parseRequest } from "../src/agent/intent";
import { planFromRequest } from "../src/agent/planner";
import { RECOMMENDED_SCHEME } from "../src/core/spatialPlanner";
import { LocalPlannerProvider, MockProvider } from "../src/agent/provider";
import { QuickAgent } from "../src/agent/quickAgent";
import { Store } from "../src/state/store";
import { createDefaultProject, type Project, type SceneObject } from "../src/core/model";

function obj(over: Partial<SceneObject> & { id: string }): SceneObject {
  return {
    kind: "table", x: 2, z: 2, rotationDeg: 0, width: 1.2, depth: 0.6, height: 0.74,
    locked: false, hidden: false, surface: "floor", elevation: 0,
    ...over,
  } as SceneObject;
}

/** A staffed room with a real door, so references can actually resolve. */
function staffedRoom(): Project {
  const p = createDefaultProject();
  p.classroom = { ...p.classroom, length: 12, width: 9 };
  p.corridor = { ...p.corridor, x: 0, z: 9, length: 12, width: 2 };
  p.objects.push(
    obj({ id: "door1", kind: "door", x: 6, z: 9, width: 0.9, depth: 0.1, height: 2, surface: "wall", assetId: "builtin:door" }),
    obj({ id: "reg1", kind: "regTable", x: 3, z: 7, width: 1.5, depth: 0.7, assetId: "builtin:regTable", serviceRole: "checkin" }),
    obj({ id: "pay1", kind: "regTable", x: 9, z: 7, width: 1.5, depth: 0.7, assetId: "builtin:regTable", serviceRole: "payment" }),
  );
  return p;
}

const plan = (text: string, project = staffedRoom()) => planFromRequest(parseRequest(text), project);
const tools = (text: string, project = staffedRoom()) => plan(text, project).steps.map((s) => s.call.tool);

describe("the six target sentences", () => {
  it("1 — lays out a 60-person tea gathering, then simulates", () => {
    const t = tools("幫我排一個 60 人的禪學社茶會，入口先報到，收費另外分流，地墊放中央，門口保留 1.2 公尺，最後模擬人流。");
    expect(t).toEqual([
      "getVenueGeometry", "generateLayoutCandidates", "applySmartLayout", "validateLayout", "simulateScenario",
    ]);
    const p = plan("幫我排一個 60 人的禪學社茶會，入口先報到，收費另外分流，地墊放中央，門口保留 1.2 公尺，最後模擬人流。");
    const brief = p.steps.find((s) => s.call.tool === "generateLayoutCandidates")!.call.args!;
    expect(brief.participants).toBe(60);
    expect(brief.eventType).toBe("tea-gathering");
    expect(brief.doorClearance).toBeCloseTo(1.2, 6);
    expect(brief.objectives).toContain("separate-checkin-payment");
    // The step applies whatever scored best for these objectives — one
    // decision, made by the measured score, not by a second heuristic that can
    // disagree with the recommendation the user is reading.
    const applied = p.steps.find((s) => s.call.tool === "applySmartLayout")!.call.args!;
    expect(applied.candidateId).toBe(RECOMMENDED_SCHEME);
    expect(applied.objectives).toContain("separate-checkin-payment");
  });

  it("1b — and what it applies really does split check-in from payment", async () => {
    // The assertion that matters is the outcome, not the scheme id: 分流 was
    // asked for, so the committed draft must end up with two service desks.
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    const r = await agent.run({
      text: "幫我排一個 60 人的禪學社茶會，入口先報到，收費另外分流，門口保留 1.2 公尺",
    });
    expect(r.toolResults.filter((x) => !x.ok)).toEqual([]);
    const draft = agent.getDraftProject()!;
    expect(draft.objects.filter((o) => o.serviceRole === "checkin").length).toBe(1);
    expect(draft.objects.filter((o) => o.serviceRole === "payment").length).toBe(1);
  });

  it("2 — proposes alternatives without applying one, and says it cannot resize the venue", () => {
    const p = plan("把這個 3×3 公尺攤位改成適合淡江大學生互動的配置，入口要清楚，不能阻擋主要通道，提出三種方案。");
    expect(p.steps.map((s) => s.call.tool)).toEqual(["getVenueGeometry", "generateLayoutCandidates"]);
    // "Propose three" must not silently apply one.
    expect(p.steps.some((s) => s.call.tool === "applySmartLayout")).toBe(false);
    expect(p.unresolved.join(" ")).toContain("場地校正");
    const brief = p.steps[1].call.args!;
    expect(brief.eventType).toBe("booth");
    expect(brief.objectives).toContain("increase-interaction");
  });

  it("3 — moves the two named desks to opposite sides and checks the gap", () => {
    const p = plan("把報到桌移到入口右側，收費桌移到左側，兩邊各保留一公尺走道。");
    expect(p.steps.map((s) => s.call.tool)).toEqual([
      "getVenueGeometry", "moveAsset", "moveAsset", "validateLayout", "measureGap",
    ]);
    const moves = p.steps.filter((s) => s.call.tool === "moveAsset").map((s) => s.call.args!);
    expect(moves.map((m) => m.objectId)).toEqual(["reg1", "pay1"]);
    // The entrance is on the south wall, so entering you face -Z and your right
    // hand points at -X. Check-in goes to smaller x than payment.
    expect(Number(moves[0].x)).toBeLessThan(Number(moves[1].x));
    // The stated one-metre aisle has to reach the geometry.
    expect(Math.abs(Number(moves[0].x) - Number(moves[1].x))).toBeGreaterThanOrEqual(1.0);
  });

  it("4 — diagnoses first, then proposes, then compares", () => {
    const t = tools("找出目前最塞的地方，提出兩種改善方案，模擬後推薦一個。");
    expect(t).toEqual([
      "getVenueGeometry", "explainBottleneck", "generateLayoutCandidates", "compareScenarios",
    ]);
    // The order is the answer: alternatives are a response to the diagnosis.
    expect(t.indexOf("explainBottleneck")).toBeLessThan(t.indexOf("generateLayoutCandidates"));
  });

  it("5 — creates a sized asset and places it, threading the new id", () => {
    const p = plan("匯入這張桌子的照片，建立簡化 3D 素材，尺寸先用 180×60×74 公分，放到報到區。");
    expect(p.steps.map((s) => s.call.tool)).toContain("createCustomAssetProxy");
    expect(p.steps.map((s) => s.call.tool)).toContain("placeAsset");
    const create = p.steps.find((s) => s.call.tool === "createCustomAssetProxy")!.call.args!;
    expect(create.width).toBeCloseTo(1.8, 6);
    expect(create.depth).toBeCloseTo(0.6, 6);
    expect(create.height).toBeCloseTo(0.74, 6);
    expect(create.serviceRole).toBe("checkin");
    // The placement cannot know the id yet; it must ask for it explicitly.
    const place = p.steps.find((s) => s.call.tool === "placeAsset")!.call.args!;
    expect(place.assetId).toBe("<from:createCustomAssetProxy>");
  });

  it("5b — furniture named in the sentence reaches the plan and gets placed", async () => {
    // 「需要的素材」 was a stated brief input that only supported seating, so a
    // sentence naming tables produced a layout silently missing them.
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    const r = await agent.run({ text: "幫我排一個 40 人的茶會，要三張長桌、兩個投影幕" });
    expect(r.toolResults.filter((x) => !x.ok)).toEqual([]);

    const brief = r.plan.length > 0
      ? (planFromRequest(parseRequest("幫我排一個 40 人的茶會，要三張長桌、兩個投影幕"), staffedRoom())
        .steps.find((s) => s.call.tool === "generateLayoutCandidates")!.call.args!)
      : {};
    expect(brief.requiredAssets).toEqual([
      { assetId: "builtin:table", count: 3 },
      { assetId: "builtin:screen", count: 2 },
    ]);

    const draft = agent.getDraftProject()!;
    expect(draft.objects.filter((o) => o.assetId === "builtin:table").length).toBe(3);
    expect(draft.objects.filter((o) => o.assetId === "builtin:screen").length).toBe(2);
  });

  it("6 — exports the staff plan and the material list", () => {
    const t = tools("根據目前場地，產生一張工作人員看得懂的場佈圖與物資清單。");
    expect(t).toContain("exportPlanImage");
    expect(t).toContain("exportMaterialList");
  });
});

describe("making the stall's own props and collateral", () => {
  const run = async (text: string) => {
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    const r = await agent.run({ text });
    return { r, draft: agent.getDraftProject()!, store };
  };

  it("makes an A2 poster with the words on it, at A2", async () => {
    const { r, draft } = await run("幫我做一張 A2 海報，印上「淡江禪學社招生」");
    expect(r.toolResults.filter((x) => !x.ok)).toEqual([]);
    const prop = draft.props![0];
    expect(prop.print!.standard).toBe("A2");
    expect(prop.dimensions.width).toBeCloseTo(0.42, 3);
    expect(prop.parts[prop.parts.length - 1].text).toBe("淡江禪學社招生");
  });

  it("carries the print run through to the order", async () => {
    const { draft } = await run("做 500 張雙面 A5 傳單");
    expect(draft.props![0].print).toMatchObject({ standard: "A5", quantity: 500, sides: 2 });
  });

  it("makes a backdrop at a real backdrop size", async () => {
    const { draft } = await run("做一個合照背景牆");
    const prop = draft.props![0];
    expect(prop.category).toBe("背景");
    expect(prop.dimensions.width).toBeCloseTo(2.4, 2);
  });

  it("makes a table item without inventing a print spec for it", async () => {
    const { draft } = await run("做一個抽獎箱");
    const prop = draft.props![0];
    expect(prop.category).toBe("擺攤小物");
    expect(prop.print).toBeUndefined();
  });

  it("calls a poster a 文宣, not an 互動道具", async () => {
    // The change note's noun was hard-coded, so an A2 poster was announced as
    // an interactive prop — the one word a volunteer reads to decide whether
    // this is the thing they asked for.
    const { r } = await run("幫我做一張 A2 海報");
    const notes = r.summary.notes.join(" ");
    expect(notes).toContain("新增文宣");
    expect(notes).not.toContain("互動道具");
  });

  it("calls a raffle box an 擺攤小物", async () => {
    const { r } = await run("做一個抽獎箱");
    expect(r.summary.notes.join(" ")).toContain("新增擺攤小物");
  });

  it("still lands in the preview gate, not the committed plan", async () => {
    const { store } = await run("幫我做一張 A2 海報");
    expect(store.getState().props ?? []).toEqual([]);
  });
});

describe("resolution is honest", () => {
  it("reports a reference the plan cannot satisfy instead of moving something else", () => {
    const empty = createDefaultProject();
    const p = plan("把報到桌移到入口右側", empty);
    expect(p.steps.some((s) => s.call.tool === "moveAsset")).toBe(false);
    expect(p.unresolved.join(" ")).toContain("報到桌");
  });

  it("resolves a desk by its service role, not by being the first table", () => {
    const room = staffedRoom();
    room.objects.unshift(obj({ id: "decoy", kind: "table", x: 1, z: 1 }));
    const p = plan("把收費桌移到左側", room);
    const move = p.steps.find((s) => s.call.tool === "moveAsset")!.call.args!;
    expect(move.objectId).toBe("pay1");
  });

  it("puts left and right on the correct sides for a north entrance too", () => {
    const north = staffedRoom();
    north.corridor = { ...north.corridor, z: -2 };
    north.objects = north.objects.map((o) => (o.id === "door1" ? { ...o, z: 0 } : o));
    const p = plan("把報到桌移到入口右側，收費桌移到左側", north);
    const moves = p.steps.filter((s) => s.call.tool === "moveAsset").map((s) => s.call.args!);
    // Entering from the north you face +Z, so your right hand points at +X —
    // the opposite of the south-entrance case.
    expect(Number(moves[0].x)).toBeGreaterThan(Number(moves[1].x));
  });

  it("keeps every planned coordinate inside the room", () => {
    const room = staffedRoom();
    const p = plan("把報到桌移到入口右側保留 20 公尺", room);
    for (const step of p.steps) {
      if (step.call.tool !== "moveAsset") continue;
      const a = step.call.args!;
      expect(Number(a.x)).toBeGreaterThanOrEqual(room.classroom.x);
      expect(Number(a.x)).toBeLessThanOrEqual(room.classroom.x + room.classroom.length);
    }
  });

  it("gives every step a reason", () => {
    const p = plan("幫我排一個 60 人的茶會，最後模擬人流");
    for (const s of p.steps) expect(s.because.length, `${s.call.tool} 沒有理由`).toBeGreaterThan(0);
  });

  it("does the same work only once", () => {
    // 「找出最塞的地方，提出兩種改善方案」 fires two intents that both want the
    // candidates; running the full simulation twice is pure waste.
    const t = tools("找出目前最塞的地方，提出兩種改善方案");
    expect(t.filter((x) => x === "generateLayoutCandidates").length).toBe(1);
  });

  it("falls back to reading the plan when nothing is understood", () => {
    const t = tools("今天天氣如何");
    expect(t).toEqual(["getProjectSummary", "getValidationIssues"]);
  });
});

describe("orchestration", () => {
  it("threads a produced id into a later step", async () => {
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    const r = await agent.run({ text: "建立簡化 3D 素材，尺寸先用 180×60×74 公分，放到報到區" });
    const failures = r.toolResults.filter((x) => !x.ok);
    expect(failures, failures.map((f) => `${f.tool}: ${f.error}`).join("; ")).toEqual([]);
    // The placed object really carries the id the first step created.
    const draft = agent.getDraftProject()!;
    const assetId = draft.catalogExtras!.at(-1)!.id;
    expect(draft.objects.some((o) => o.assetId === assetId)).toBe(true);
  });

  it("fails the dependent step honestly when its producer failed", async () => {
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, {
      id: "stub",
      async complete() {
        return {
          intents: [],
          toolCalls: [
            // A producer that cannot succeed, followed by a consumer of its id.
            { tool: "createCustomAssetProxy" as const, args: { name: "x", width: -5 } },
            { tool: "placeAsset" as const, args: { assetId: "<from:createCustomAssetProxy>" } },
          ],
          message: "",
          provider: "stub",
        };
      },
    });
    const r = await agent.run({ text: "irrelevant" });
    expect(r.toolResults[0].ok).toBe(false);
    expect(r.toolResults[1].ok).toBe(false);
    expect(r.toolResults[1].error).toContain("createCustomAssetProxy");
    // Nothing was placed with a literal placeholder string.
    expect(agent.getDraftProject()!.objects.some((o) => o.assetId?.startsWith("<from:"))).toBe(false);
  });

  it("surfaces understanding, assumptions and unresolved references as cards", async () => {
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    const r = await agent.run({ text: "幫我排一個茶會" });
    expect(r.understanding.length).toBeGreaterThan(0);
    expect(r.assumptions.length).toBeGreaterThan(0);
    expect(r.cards.some((c) => c.title === "假設")).toBe(true);
  });

  it("never lets a plan call commit or rollback", async () => {
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, {
      id: "stub",
      async complete() {
        return {
          intents: [],
          toolCalls: [{ tool: "commitAgentChanges" as const, args: {} }],
          message: "",
          provider: "stub",
        };
      },
    });
    const r = await agent.run({ text: "x" });
    expect(r.toolResults).toEqual([]);
    expect(store.getState().objects.length).toBe(3);
  });

  it("keeps the committed project untouched until commit", async () => {
    const store = new Store(staffedRoom());
    const before = structuredClone(store.getState());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    await agent.run({ text: "幫我排一個 40 人的茶會" });
    expect(store.getState()).toEqual(before);

    agent.commit();
    expect(store.getState()).not.toEqual(before);

    store.undo();
    expect(store.getState().objects.length).toBe(before.objects.length);
  });

  it("rollback leaves the plan exactly as it was", async () => {
    const store = new Store(staffedRoom());
    const before = structuredClone(store.getState());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    await agent.run({ text: "幫我排一個 40 人的茶會" });
    agent.rollback();
    expect(agent.isPreviewActive()).toBe(false);
    expect(store.getState()).toEqual(before);
  });

  it("keeps MockProvider working as the test fallback", async () => {
    const store = new Store(createDefaultProject());
    const agent = new QuickAgent(store, new MockProvider());
    const r = await agent.run({ text: "這裡放兩個報到桌" });
    expect(r.summary.addedObjectIds.length).toBe(2);
  });

  it("MockProvider no longer drops the prop recipe on the floor", async () => {
    // The tool was implemented, allowlisted and reachable; it was missing only
    // from the provider's output filter, so the recipe vanished silently.
    const store = new Store(createDefaultProject());
    const agent = new QuickAgent(store, new MockProvider());
    await agent.run({ text: "幫我做一個六面骰子，每面一個題目" });
    expect(agent.getDraftProject()!.props?.length).toBe(1);
  });

  it("applyScheme overrides the recommendation with the user's choice", async () => {
    // The user read the A/B/C table and picked a row. That is an explicit
    // decision and it wins over the engine's recommendation — while still
    // going through the same preview gate.
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    const first = await agent.run({ text: "幫我排一個 40 人的茶會，提出三種方案" });
    const gen = first.toolResults.find((t) => t.tool === "generateLayoutCandidates")!;
    const recommended = (gen.data as { recommendedId: string }).recommendedId;
    const other = ["scheme-a", "scheme-b", "scheme-c"].find((x) => x !== recommended)!;

    const second = await agent.run({
      text: "幫我排一個 40 人的茶會，提出三種方案",
      applyScheme: other,
    });
    const applied = second.toolResults.find((t) => t.tool === "applySmartLayout");
    expect(applied?.ok).toBe(true);
    expect((applied!.data as { candidateId: string }).candidateId).toBe(other);
    // Still a preview, still nothing committed.
    expect(second.previewActive).toBe(true);
    expect(store.getState().groups.length).toBe(0);
  });

  it("applyScheme swaps the candidate when the plan already had one", async () => {
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, new LocalPlannerProvider());
    const r = await agent.run({ text: "幫我排一個 40 人的茶會", applyScheme: "scheme-c" });
    const applied = r.toolResults.filter((t) => t.tool === "applySmartLayout");
    expect(applied.length).toBe(1);
    expect((applied[0].data as { candidateId: string }).candidateId).toBe("scheme-c");
  });

  it("recovers from a provider that throws", async () => {
    const store = new Store(staffedRoom());
    const agent = new QuickAgent(store, {
      id: "boom",
      async complete(): Promise<never> { throw new Error("network down"); },
    });
    const r = await agent.run({ text: "隨便" });
    expect(r.response.provider).toBe("fallback");
    expect(r.previewActive).toBe(true);
  });
});
