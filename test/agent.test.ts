import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../src/core/model";
import { Store } from "../src/state/store";
import { MockProvider } from "../src/agent/provider";
import { QuickAgent } from "../src/agent/quickAgent";
import { AgentTransaction } from "../src/agent/transaction";
import { isAllowedTool } from "../src/agent/tools";
import { AgentExecutor } from "../src/agent/executor";
import { ReconstructionQueue } from "../src/assets/reconstruction";

describe("agent allowlist", () => {
  it("accepts known tools and rejects others", () => {
    expect(isAllowedTool("placeAsset")).toBe(true);
    expect(isAllowedTool("commitAgentChanges")).toBe(true);
    expect(isAllowedTool("rm -rf")).toBe(false);
    expect(isAllowedTool("mutateStoreJson")).toBe(false);
  });
});

describe("agent transaction", () => {
  it("preview does not mutate committed project until commit", () => {
    const store = new Store(createDefaultProject());
    const before = store.getState().objects.length;
    const tx = new AgentTransaction();
    const draft = tx.start(store.getState());
    draft.objects.push({
      id: "tmp",
      kind: "table",
      x: 1,
      z: 1,
      rotationDeg: 0,
      width: 1.2,
      depth: 0.6,
      height: 0.74,
      locked: false,
      hidden: false,
      surface: "floor",
      elevation: 0,
      assetId: "builtin:table",
    });
    expect(store.getState().objects.length).toBe(before);
    expect(tx.getDraft()!.objects.length).toBe(before + 1);

    tx.rollback();
    expect(tx.isActive).toBe(false);
    expect(store.getState().objects.length).toBe(before);
  });

  it("commit is a single undoable store mutation", () => {
    const store = new Store(createDefaultProject());
    const tx = new AgentTransaction();
    tx.start(store.getState());
    tx.mutate((p) => {
      p.objects.push({
        id: "a1",
        kind: "regTable",
        x: 2,
        z: 2,
        rotationDeg: 0,
        width: 1.5,
        depth: 0.7,
        height: 0.74,
        locked: false,
        hidden: false,
        surface: "floor",
        elevation: 0,
        assetId: "builtin:regTable",
        serviceRole: "checkin",
      });
    });
    tx.commit(store);
    expect(store.getState().objects.some((o) => o.id === "a1")).toBe(true);
    store.undo();
    expect(store.getState().objects.some((o) => o.id === "a1")).toBe(false);
  });
});

describe("quick agent mock provider", () => {
  it("places two registration desks via tools and supports rollback", async () => {
    const store = new Store(createDefaultProject());
    const agent = new QuickAgent(store, new MockProvider());
    const result = await agent.run({ text: "這裡放兩個報到桌" });
    expect(result.previewActive).toBe(true);
    expect(result.summary.addedObjectIds.length).toBe(2);
    expect(store.getState().objects.length).toBe(0); // not committed

    agent.rollback();
    expect(agent.isPreviewActive()).toBe(false);
    expect(store.getState().objects.length).toBe(0);
  });

  it("commit then undo restores", async () => {
    const store = new Store(createDefaultProject());
    const agent = new QuickAgent(store, new MockProvider());
    await agent.run({ text: "這裡放兩個報到桌" });
    agent.commit();
    expect(store.getState().objects.length).toBe(2);
    store.undo();
    expect(store.getState().objects.length).toBe(0);
  });

  it("provider failure falls back without crashing", async () => {
    const store = new Store(createDefaultProject());
    const failing = {
      id: "fail",
      async complete(): Promise<never> {
        throw new Error("network down");
      },
    };
    const agent = new QuickAgent(store, failing);
    const result = await agent.run({ text: "隨便" });
    expect(result.response.provider).toBe("fallback");
    expect(result.previewActive).toBe(true);
  });

  it("rejects unknown tools in executor", async () => {
    const store = new Store(createDefaultProject());
    const tx = new AgentTransaction();
    tx.start(store.getState());
    const ex = new AgentExecutor(tx, {
      selectionIds: [],
      reconstructionQueue: new ReconstructionQueue(),
    });
    const r = await ex.run({ tool: "mutateStoreJson" as never, args: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/允許清單/);
  });

  it("simulate intent uses DES event-flow adapter", async () => {
    const store = new Store(createDefaultProject());
    const agent = new QuickAgent(store, new MockProvider());
    const result = await agent.run({ text: "模擬 60 人進場" });
    expect(result.response.message).not.toMatch(/尚未合併/);
    const sim = result.toolResults.find((t) => t.tool === "simulateScenario");
    expect(sim?.ok).toBe(true);
    const data = sim?.data as { available?: boolean; result?: { completed: number }; message?: string };
    expect(data?.available).toBe(true);
    expect(data?.result?.completed).toBeGreaterThan(0);
  });

  it("compare scenarios tool returns A/B winner reason", async () => {
    const store = new Store(createDefaultProject());
    const agent = new QuickAgent(store, new MockProvider());
    const result = await agent.run({ text: "比較報到收費同桌與分桌" });
    const cmp = result.toolResults.find((t) => t.tool === "compareScenarios");
    expect(cmp?.ok).toBe(true);
    const data = cmp?.data as {
      available: boolean;
      comparison: { winner: string; reason: string };
    };
    expect(data.available).toBe(true);
    expect(data.comparison.reason.length).toBeGreaterThan(4);
  });
});
