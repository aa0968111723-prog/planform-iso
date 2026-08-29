/**
 * Optional OpenAI-compatible chat completions → AgentResponse.
 * Tools stay preview → 套用. No key / network error → caller falls back.
 */

import type { AgentProvider } from "./provider";
import type { AgentRequest, AgentResponse, AgentToolCall, AgentToolName } from "./types";
import { getLlmSettings } from "./llmSettings";

const ALLOWED: ReadonlySet<string> = new Set([
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
  "createZone",
  "createRoute",
]);

const SYSTEM = `你是平面場 ISO 的場佈助手。只回 JSON，格式：
{"message":"給志工看的一句話","toolCalls":[{"tool":"工具名","args":{}}]}
可用工具：placeAsset, createZone, createRoute, validateLayout, getValidationIssues, simulateScenario, compareScenarios, createCustomAssetProxy, getProjectSummary, createServiceStation, updateServiceStation。
placeAsset args: {assetId, target} target 常用 near-entrance。
simulateScenario args: {participants}。
不要發明不在清單裡的工具。不要直接改專案 JSON。`;

export class OpenAICompatibleProvider implements AgentProvider {
  readonly id = "openai-compatible";

  async complete(request: AgentRequest): Promise<AgentResponse> {
    const s = getLlmSettings();
    if (!s.apiKey.trim()) {
      throw new Error("missing-api-key");
    }
    const endpoint = s.endpoint.replace(/\/$/, "");
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: s.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: request.text },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`llm-http-${res.status}`);
    }
    const json = await res.json() as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    return parseAgentJson(content, this.id);
  }
}

export function parseAgentJson(content: string, provider: string): AgentResponse {
  let parsed: { message?: string; toolCalls?: { tool?: string; args?: Record<string, unknown> }[] };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("llm-bad-json");
    }
    parsed = JSON.parse(content.slice(start, end + 1)) as typeof parsed;
  }
  const toolCalls: AgentToolCall[] = (parsed.toolCalls ?? [])
    .filter((c): c is { tool: AgentToolName; args?: Record<string, unknown> } =>
      typeof c.tool === "string" && ALLOWED.has(c.tool))
    .map((c) => ({ tool: c.tool, args: c.args ?? {} }));
  return {
    intents: toolCalls.length ? [{ type: "unknown", raw: parsed.message ?? "" }] : [{ type: "unknown", raw: content }],
    toolCalls: toolCalls.length ? toolCalls : [{ tool: "getProjectSummary", args: {} }],
    message: (parsed.message ?? "已理解。").trim() || "已理解。",
    provider,
  };
}
