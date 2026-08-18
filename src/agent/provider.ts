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
      toolCalls.push({ tool: "splitPaymentFlow", args: {} });
      messages.push("預覽：報到與收費分開。");
    }

    if (/1\s*公尺|不要擋門|入口旁邊|留\s*1|報到不要堵/.test(text)) {
      intents.push({ type: "optimize-layout", objectives: ["clear-doors"] });
      toolCalls.push({ tool: "validateLayout", args: { optimize: "clear-doors" } });
      toolCalls.push({ tool: "optimizeEventFlow", args: { objective: "smoothest-flow" } });
      messages.push("檢查門前淨空，並尋找較不堵入口的方案。");
    }

    // Configure registration from natural counts, e.g. 60 人、20 個現場繳費
    if (/現場繳|已繳|報到流程|排順/.test(text) && /\d+\s*人/.test(text)) {
      const n = Number((text.match(/(\d+)\s*人/) ?? [])[1] ?? 60);
      const onsite = Number((text.match(/(\d+)\s*個?\s*要?現場繳/) ?? text.match(/現場繳\s*(\d+)/) ?? [])[1] ?? Math.round(n / 3));
      intents.push({
        type: "configure-registration",
        participants: n,
        onsitePayment: onsite,
        prepaid: n - onsite,
      });
      toolCalls.push({
        tool: "configureScenario",
        args: {
          participants: n,
          onsitePaymentCount: onsite,
          prepaidCount: n - onsite,
          checkinStaff: 2,
          paymentStaff: 1,
        },
      });
      toolCalls.push({ tool: "optimizeEventFlow", args: { objective: "least-wait" } });
      messages.push(`設定 ${n} 人（現場繳 ${onsite}），並預覽較順方案。`);
    } else if (/模擬|人進場|60\s*人/.test(text)) {
      const n = Number((text.match(/(\d+)\s*人/) ?? [])[1] ?? 60);
      intents.push({ type: "simulate", participants: n });
      toolCalls.push({ tool: "simulateScenario", args: { participants: n } });
      messages.push(`將以本地流程模擬 ${n} 人進場（報到／收費分流）。`);
    }

    if (/比較|同桌|分桌|報到.*收費.*比/.test(text)) {
      intents.push({ type: "simulate", participants: 60 });
      toolCalls.push({ tool: "compareScenarios", args: { participants: 60 } });
      toolCalls.push({ tool: "generateLayoutCandidates", args: {} });
      messages.push("比較同桌／分桌／分流方案。");
    }

    if (/哪裡最塞|瓶頸|塞車|最塞/.test(text)) {
      intents.push({ type: "explain-bottleneck" });
      toolCalls.push({ tool: "findBottlenecks", args: { participants: 60 } });
      toolCalls.push({ tool: "focusIssue", args: {} });
      messages.push("模擬進場並標出最塞站點。");
    }

    if (/少\s*一?\s*個?\s*工作人員|少一個人|少\s*1\s*人|會怎樣/.test(text) && /少|怎樣|人力/.test(text)) {
      intents.push({ type: "what-if-staff", remove: 1 });
      toolCalls.push({ tool: "readScenario", args: {} });
      toolCalls.push({ tool: "assignStaff", args: { remove: 1 } });
      toolCalls.push({ tool: "simulateScenario", args: {} });
      messages.push("預覽少一個工作人員的影響（不會直接改正式場佈）。");
    }

    if (/幫我改善|優化|最快方案|給我最快|排順一點/.test(text)) {
      const obj = /最快/.test(text)
        ? "fastest"
        : /省人|少人|人力/.test(text)
          ? "least-staff"
          : /排隊|等待/.test(text)
            ? "least-wait"
            : /順|堵|動線/.test(text)
              ? "smoothest-flow"
              : "fastest";
      intents.push({ type: "optimize-event", objective: obj });
      toolCalls.push({ tool: "optimizeEventFlow", args: { objective: obj } });
      toolCalls.push({ tool: "explainImprovement", args: {} });
      messages.push("本地優化引擎搜尋可量化改善方案。");
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
      "configureScenario",
      "splitPaymentFlow",
      "assignStaff",
      "findBottlenecks",
      "generateLayoutCandidates",
      "optimizeEventFlow",
      "explainImprovement",
      "focusIssue",
      "readScenario",
      "readSimulationResult",
    ]);
    const cleaned: AgentToolCall[] = toolCalls.filter((c) => allowed.has(c.tool));

    if (intents.length === 0) {
      intents.push({ type: "unknown", raw: text });
      cleaned.push({ tool: "getProjectSummary", args: {} });
      messages.push("我可以幫你：建素材、場佈、模擬、比較方案、少人力會怎樣、優化。試著說「60 人，有 20 個要現場繳費，幫我排順一點」。");
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
