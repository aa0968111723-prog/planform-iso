/**
 * Compact「✦ AI 幫我」sheet — not a permanent chat sidebar.
 *
 * Six task chips (排場佈 / 排地墊 / 畫動線 / 檢查 / 改善 / 夥伴圖) plus a
 * one-line natural-language input. Everything the agent proposes goes through
 * preview → 套用/取消, never straight into the real plan. All of it runs on
 * the local deterministic tool layer — no cloud credential required.
 */

import type { App } from "../app/App";
import type { QuickAgentResult } from "../agent/quickAgent";
import { button, el } from "./dom";

export interface QuickAgentSheetHandles {
  root: HTMLElement;
  open: (preset?: string) => void;
  close: () => void;
  isOpen: () => boolean;
  /** Open the sheet and immediately run a canned request (e.g. 幫我改善). */
  runPreset: (text: string) => void;
}

/** UI-side shortcuts the sheet can jump to (they are app actions, not LLM calls). */
export interface QuickAgentHooks {
  openMatArranger?: () => void;
  startEntryRoute?: () => void;
  openCheck?: () => void;
  sharePartnerImage?: () => void;
}

const TOOL_LABEL: Record<string, string> = {
  placeAsset: "放置物品",
  createZone: "建立區域",
  createRoute: "建立動線",
  validateLayout: "檢查場佈",
  simulateScenario: "模擬活動",
  compareScenarios: "比較方案",
  createCustomAssetProxy: "建立素材",
};

export function buildQuickAgentSheet(app: App, hooks: QuickAgentHooks = {}): QuickAgentSheetHandles {
  const root = el("div", { class: "agent-sheet", style: "display:none" });
  const body = el("div", { class: "agent-sheet__body" });
  const input = el("textarea", {
    class: "field__input agent-sheet__input",
    placeholder: "例如：30 人社課，中間留走道",
    rows: "2",
  }) as HTMLTextAreaElement;
  const cards = el("div", { class: "agent-sheet__cards" });
  const previewBar = el("div", { class: "agent-sheet__preview", style: "display:none" });

  const jump = (fn?: () => void) => () => {
    close();
    fn?.();
  };

  const actions = el("div", { class: "agent-sheet__actions" }, [
    button("🪑 幫我排場佈", () => {
      input.value = "這裡放兩個報到桌";
      void run();
    }, "chip"),
    button("🟪 幫我排地墊", jump(hooks.openMatArranger), "chip"),
    button("🚶 幫我畫動線", jump(hooks.startEntryRoute), "chip"),
    button("🔍 幫我檢查", jump(hooks.openCheck), "chip"),
    button("✨ 幫我改善", () => {
      input.value = "幫我改善，入口旁邊留 1 公尺不要擋門";
      void run();
    }, "chip"),
    button("🖼 幫我做夥伴圖", jump(hooks.sharePartnerImage), "chip"),
  ]);

  const runBtn = button("執行", () => void run(), "btn chip--primary");
  const closeBtn = button("關閉", () => close(), "chip");

  previewBar.append(
    el("div", { class: "agent-sheet__preview-label", text: "預覽就緒 — 看畫布上的結果" }),
    button("套用", () => {
      if (!app.quickAgent.isPreviewActive()) return;
      app.quickAgent.commit();
      app.applyAgentPreview(null);
      previewBar.style.display = "none";
      cards.append(el("div", { class: "agent-card", text: "已套用（可復原）" }));
      app.notifyToast?.("已套用 AI 變更", true);
    }, "chip chip--primary"),
    button("取消", () => {
      app.quickAgent.rollback();
      app.applyAgentPreview(null);
      previewBar.style.display = "none";
      cards.append(el("div", { class: "agent-card", text: "已取消，場佈維持原樣" }));
    }, "chip"),
  );

  body.append(
    el("div", { class: "agent-sheet__title", text: "✦ AI 幫我" }),
    el("p", { class: "hint", text: "用一句話說需求，先看預覽再決定要不要套用。例：「入口這邊要報到，20 個人會現場繳費」。" }),
    actions,
    input,
    el("div", { class: "row wrap", style: "gap:6px;margin-top:8px" }, [runBtn, closeBtn]),
    previewBar,
    cards,
  );
  root.append(body);

  async function run(): Promise<void> {
    const text = input.value.trim();
    if (!text) return;
    cards.innerHTML = "";
    cards.append(el("div", { class: "agent-card", text: "處理中…" }));
    try {
      const last: QuickAgentResult = await app.quickAgent.run({
        text,
        selectionIds: [...app.session.selection],
      });
      cards.innerHTML = "";
      for (const c of last.cards) {
        cards.append(
          el("div", { class: "agent-card" }, [
            el("div", { class: "agent-card__title", text: humanizeCardTitle(c.title) }),
            el("div", { class: "agent-card__detail", text: c.detail }),
          ]),
        );
      }
      if (last.previewActive) {
        previewBar.style.display = "flex";
        app.applyAgentPreview(app.quickAgent.getDraftProject());
      }
    } catch {
      cards.innerHTML = "";
      cards.append(
        el("div", {
          class: "agent-card",
          text: "這一步沒有成功，場佈沒有被改動。換個說法再試一次。",
        }),
      );
    }
  }

  function humanizeCardTitle(title: string): string {
    for (const [tool, label] of Object.entries(TOOL_LABEL)) {
      if (title.includes(tool)) return title.replace(tool, label);
    }
    return title;
  }

  function open(preset?: string): void {
    root.style.display = "block";
    if (preset) input.value = preset;
    input.focus();
  }

  function close(): void {
    root.style.display = "none";
  }

  return {
    root,
    open,
    close,
    isOpen: () => root.style.display !== "none",
    runPreset: (text: string) => {
      open(text);
      void run();
    },
  };
}
