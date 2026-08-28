/**
 * Agent provider abstraction.
 *
 * The shipping provider is the local deterministic parser — no network, no
 * credential, same result every time. A cloud LLM provider can implement
 * AgentProvider later; the tool layer, preview and commit gates stay identical
 * either way, and a cloud provider never receives the plan document.
 *
 * Two providers live here:
 *
 * - `LocalPlannerProvider` (the default) runs the structured parser in
 *   `intent.ts` and hands the orchestrator a `parsed` reading. It emits no tool
 *   calls itself, because planning needs the project and a provider does not
 *   get the project.
 * - `MockProvider` is the older keyword mapper, kept as an explicit test
 *   fallback and for the fixed phrases the existing suite pins.
 */

import { parseRequest } from "./intent";
import type { AgentIntent, AgentRequest, AgentResponse, AgentToolCall } from "./types";

export interface AgentProvider {
  readonly id: string;
  complete(request: AgentRequest): Promise<AgentResponse>;
}

/** Deterministic phrase → intent mapper for tests and offline use. */
export class MockProvider implements AgentProvider {
  readonly id = "mock";

  async complete(request: AgentRequest): Promise<AgentResponse> {
    const text = request.text.trim();
    const intents: AgentIntent[] = [];
    const toolCalls: AgentToolCall[] = [];
    const messages: string[] = [];

    if (/照片|做成|建.*素材|自訂素材/.test(text)) {
      const payment = /收費/.test(text);
      const checkin = /報到/.test(text);
      intents.push({
        type: "create-custom-asset",
        name: payment ? "收費桌" : checkin ? "報到桌" : "自訂桌子",
        semanticHint: payment || checkin ? "service-desk" : "table",
        serviceRole: payment ? "payment" : checkin ? "checkin" : "none",
        dimensions: { width: 1.8, depth: 0.6, height: 0.74 },
      });
      toolCalls.push({
        tool: "createCustomAssetProxy",
        args: {
          name: payment ? "收費桌" : checkin ? "報到桌" : "自訂桌子",
          semanticType: "service-desk",
          serviceRole: payment ? "payment" : checkin ? "checkin" : "none",
          width: 1.8,
          depth: 0.6,
          height: 0.74,
        },
      });
      messages.push("已建立簡化素材，可立即放進場佈。");
    }

    // §35: 「幫我做一個六面骰子，每面一個題目」. Checked BEFORE the generic
    // 自訂素材 rule, which would otherwise swallow 「做一個…」 and produce a
    // flat proxy box instead of a playable prop.
    if (/(骰子|轉盤|抽卡箱|抽卡|道具|關卡)/.test(text) && /(做|建|新增|弄|生成|幫我)/.test(text)) {
      const kind = /轉盤/.test(text) ? "spinner"
        : /抽卡/.test(text) ? "cardbox"
          : /骰子/.test(text) ? "dice" : "box";
      const faceMatch = text.match(/([0-9]+|[一二三四五六七八九十]+)\s*(面|個面|格|區塊|張)/);
      const zh: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      const faceCount = faceMatch
        ? (Number(faceMatch[1]) || zh[faceMatch[1]] || 6)
        : undefined;
      const name = /轉盤/.test(text) ? "轉盤" : /抽卡/.test(text) ? "抽卡箱" : /骰子/.test(text) ? "大型骰子" : "自訂道具";
      intents.push({ type: "create-prop", name, kind, interactive: true,
        ...(faceCount ? { faces: Array.from({ length: Math.min(12, faceCount) }, (_, i) => ({ label: `第 ${i + 1} 面` })) } : {}) });
      toolCalls.push({
        tool: "createPropFromRecipe",
        args: {
          name, kind,
          ...(faceCount
            ? { faces: Array.from({ length: Math.min(12, faceCount) }, (_, i) => ({ label: `第 ${i + 1} 面` })) }
            : {}),
        },
      });
      messages.push(faceCount
        ? `做了一個 ${faceCount} 面的「${name}」，每一面的題目可以在道具工作室裡改。`
        : `做了一個「${name}」，細節可以在道具工作室裡改。`);
    }

    if (/放\s*([兩三四五六七八九十\d]+)\s*.*報到|兩個報到|2\s*個報到|報到桌/.test(text) && /放|擺|這裡/.test(text)) {
      const count = /兩|2/.test(text) ? 2 : 1;
      intents.push({ type: "place-assets", assetId: "builtin:regTable", count, target: { type: "near-entrance" } });
      for (let i = 0; i < count; i++) {
        toolCalls.push({
          tool: "placeAsset",
          args: { assetId: "builtin:regTable", target: "near-entrance", index: i },
        });
      }
      messages.push(`預覽放置 ${count} 張報到桌。`);
    } else if (/放\s*([兩三四五六七八九十\d]+)\s*.*收費|收費桌/.test(text) && /放|擺|這裡|右邊/.test(text)) {
      const count = /兩|2/.test(text) ? 2 : 1;
      intents.push({ type: "place-assets", assetId: "builtin:payment-desk", count, target: { type: "near-entrance" } });
      for (let i = 0; i < count; i++) {
        toolCalls.push({
          tool: "placeAsset",
          args: { assetId: "builtin:payment-desk", target: "near-entrance", index: i, offsetX: 2 + i * 1.8 },
        });
      }
      messages.push(`預覽放置 ${count} 張收費桌。`);
    }

    if (/報到.*收費.*分|收費.*報到.*分|分開/.test(text)) {
      intents.push({ type: "separate-service-flow", services: ["checkin", "payment"] });
      toolCalls.push({ tool: "placeAsset", args: { assetId: "builtin:regTable", target: "near-entrance", index: 0 } });
      toolCalls.push({
        tool: "placeAsset",
        args: { assetId: "builtin:payment-desk", target: "near-entrance", index: 1, offsetX: 3 },
      });
      messages.push("預覽：報到與收費分開擺放。");
    }

    if (/1\s*公尺|不要擋門|入口旁邊|留\s*1/.test(text)) {
      intents.push({ type: "optimize-layout", objectives: ["clear-doors"] });
      toolCalls.push({ tool: "validateLayout", args: { optimize: "clear-doors" } });
      messages.push("檢查門前淨空並微調阻擋物件。");
    }

    if (/模擬|人進場|60\s*人/.test(text)) {
      const n = Number((text.match(/(\d+)\s*人/) ?? [])[1] ?? 60);
      intents.push({ type: "simulate", participants: n });
      toolCalls.push({ tool: "simulateScenario", args: { participants: n } });
      messages.push(`將以本地流程模擬 ${n} 人進場（報到／收費分流）。`);
    }

    if (/比較|同桌|分桌|報到.*收費.*比/.test(text)) {
      intents.push({ type: "simulate", participants: 60 });
      toolCalls.push({ tool: "compareScenarios", args: { participants: 60 } });
      messages.push("比較「報到＋收費同桌」與「分桌」兩種方案。");
    }

    if (/哪裡最塞|瓶頸|塞車/.test(text)) {
      intents.push({ type: "explain-bottleneck" });
      toolCalls.push({ tool: "simulateScenario", args: { participants: 60 } });
      toolCalls.push({ tool: "getValidationIssues", args: {} });
      messages.push("模擬進場並標出瓶頸站點。");
    }

    if (/幫我改善|優化/.test(text)) {
      intents.push({ type: "optimize-layout", objectives: ["clear-doors", "separate-checkin-payment"] });
      toolCalls.push({ tool: "validateLayout", args: { optimize: "clear-doors" } });
      toolCalls.push({ tool: "compareScenarios", args: { participants: 60 } });
      messages.push("預覽改善：清門前，並比較報到／收費分流。");
    }

    if (/動線圖|給夥伴|整理成/.test(text)) {
      intents.push({ type: "prepare-team-view" });
      messages.push("到「分享」頁可以直接輸出動線圖或夥伴觀看圖。");
    }

    // Filter unknown tool names that Mock accidentally emitted
    const allowed = new Set([
      "createCustomAssetProxy",
      // §35 recipes were emitted above and then dropped here, so 「幫我做一個
      // 六面骰子」 produced an intent, a message and no prop. The tool was in
      // the executor and in the allowlist; it was only missing from this
      // filter, which is why nothing failed loudly.
      "createPropFromRecipe",
      "placeAsset",
      "validateLayout",
      "getValidationIssues",
      "simulateScenario",
      "getSimulationSummary",
      "compareScenarios",
      "createServiceStation",
      "updateServiceStation",
      "getProjectSummary",
    ]);
    const cleaned: AgentToolCall[] = toolCalls.filter((c) => allowed.has(c.tool));

    if (intents.length === 0) {
      intents.push({ type: "unknown", raw: text });
      cleaned.push({ tool: "getProjectSummary", args: {} });
      messages.push("我可以幫你：建素材、場佈、模擬、比較方案、檢查、優化。試著說「模擬 60 人進場」。");
    }

    return {
      intents,
      toolCalls: cleaned.length
        ? cleaned
        : [{ tool: "getProjectSummary", args: {} }],
      message: messages.join(" ") || "已理解。",
      provider: this.id,
    };
  }
}

/**
 * The shipping provider. It reads the sentence into a structured request and
 * stops there; `QuickAgent` plans the tool calls against the draft.
 */
export class LocalPlannerProvider implements AgentProvider {
  readonly id = "local-planner";

  async complete(request: AgentRequest): Promise<AgentResponse> {
    const parsed = parseRequest(request.text);
    const intents: AgentIntent[] = parsed.intents.map((i) =>
      i.type === "unknown" ? { type: "unknown", raw: request.text } : { type: "unknown", raw: i.type },
    );
    return {
      intents,
      // Empty on purpose: the orchestrator plans from `parsed`, which is the
      // only stage that can see where the entrance and the desks actually are.
      toolCalls: [],
      parsed,
      assumptions: parsed.assumptions,
      message: "",
      provider: this.id,
    };
  }
}

export function createDefaultProvider(): AgentProvider {
  return new LocalPlannerProvider();
}
