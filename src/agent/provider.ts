/**
 * Agent provider abstraction — Mock (deterministic) + optional NVIDIA NIM BYOK.
 */

import type { AgentIntent, AgentRequest, AgentResponse, AgentToolCall } from "./types";

export interface AgentProvider {
  readonly id: string;
  complete(request: AgentRequest): Promise<AgentResponse>;
}

const NIM_KEY = "planform-iso:nvidia-nim-key";

export function getNimApiKey(): string | null {
  try {
    return localStorage.getItem(NIM_KEY);
  } catch {
    return null;
  }
}

export function setNimApiKey(key: string | null): void {
  try {
    if (!key) localStorage.removeItem(NIM_KEY);
    else localStorage.setItem(NIM_KEY, key);
  } catch {
    /* ignore */
  }
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
      messages.push("已建立簡化素材，可立即排場。");
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
      messages.push("預覽：報到與收費分開摆放。");
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
      messages.push("請用匯出 → 施工圖／動線圖分享給夥伴。");
    }

    // Filter unknown tool names that Mock accidentally emitted
    const allowed = new Set([
      "createCustomAssetProxy",
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
 * Optional NVIDIA NIM BYOK adapter. Falls back to MockProvider on failure.
 * Does NOT perform geometry — only intent extraction via chat completions JSON.
 */
export class NvidiaNimProvider implements AgentProvider {
  readonly id = "nvidia-nim";
  constructor(
    private apiKey: string,
    private fallback: AgentProvider = new MockProvider(),
    private endpoint = "https://integrate.api.nvidia.com/v1/chat/completions",
  ) {}

  async complete(request: AgentRequest): Promise<AgentResponse> {
    if (!this.apiKey) return this.fallback.complete(request);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta/llama-3.1-8b-instruct",
          messages: [
            {
              role: "system",
              content:
                "You extract Planform layout intents as JSON {intents:[{type,...}], message}. Types: create-custom-asset, place-assets, separate-service-flow, simulate, optimize-layout, explain-bottleneck, prepare-team-view. No coordinates math.",
            },
            { role: "user", content: request.text },
          ],
          temperature: 0.2,
          max_tokens: 400,
        }),
      });
      if (!res.ok) return this.fallback.complete(request);
      // Prefer mock tool planning for safety even if NIM returns text.
      const mock = await this.fallback.complete(request);
      mock.provider = this.id;
      mock.message = `${mock.message}（NIM 已連線，仍由本地工具執行）`;
      return mock;
    } catch {
      return this.fallback.complete(request);
    }
  }
}

export function createDefaultProvider(): AgentProvider {
  const key = typeof localStorage !== "undefined" ? getNimApiKey() : null;
  if (key) return new NvidiaNimProvider(key, new MockProvider());
  return new MockProvider();
}
