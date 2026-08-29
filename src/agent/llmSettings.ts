/**
 * Optional OpenAI-compatible endpoint. Empty key → stay on offline rules.
 */

export const LLM_SETTINGS_KEY = "planform-iso:llm";

export interface LlmSettings {
  endpoint: string;
  model: string;
  apiKey: string;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
};

export function getLlmSettings(): LlmSettings {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_LLM_SETTINGS };
    const raw = localStorage.getItem(LLM_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_LLM_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LlmSettings>;
    return {
      endpoint: typeof parsed.endpoint === "string" && parsed.endpoint.trim()
        ? parsed.endpoint.trim()
        : DEFAULT_LLM_SETTINGS.endpoint,
      model: typeof parsed.model === "string" && parsed.model.trim()
        ? parsed.model.trim()
        : DEFAULT_LLM_SETTINGS.model,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return { ...DEFAULT_LLM_SETTINGS };
  }
}

export function setLlmSettings(patch: Partial<LlmSettings>): LlmSettings {
  const next = { ...getLlmSettings(), ...patch };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(next));
    }
  } catch {
    /* private mode */
  }
  return next;
}

export function hasLlmKey(): boolean {
  return getLlmSettings().apiKey.trim().length > 0;
}

export function llmHonestyLine(): string {
  return hasLlmKey()
    ? "已設定金鑰：走 OpenAI 相容雲端模型。失敗會退回離線規則。一律先預覽再套用。"
    : "沒金鑰用離線規則／關鍵字。有金鑰（更多 → 雲端 AI）走 OpenAI 相容模型。一律先預覽再套用。";
}
