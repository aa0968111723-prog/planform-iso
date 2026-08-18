/**
 * Compact Quick Agent sheet — not a permanent chat sidebar.
 * Entry: ✦ AI 幫我 → 建素材 / 幫我場佈 / 模擬活動 / 幫我優化 + NL input.
 */

import type { App } from "../app/App";
import type { QuickAgentResult } from "../agent/quickAgent";
import { button, el } from "./dom";

export interface QuickAgentSheetHandles {
  root: HTMLElement;
  open: (preset?: string) => void;
  close: () => void;
  isOpen: () => boolean;
}

export function buildQuickAgentSheet(app: App): QuickAgentSheetHandles {
  const root = el("div", { class: "agent-sheet", style: "display:none" });
  const body = el("div", { class: "agent-sheet__body" });
  const input = el("textarea", {
    class: "field__input agent-sheet__input",
    placeholder: "例如：這裡放兩個報到桌",
    rows: "2",
  }) as HTMLTextAreaElement;
  const cards = el("div", { class: "agent-sheet__cards" });
  const previewBar = el("div", { class: "agent-sheet__preview", style: "display:none" });
  let last: QuickAgentResult | null = null;

  const actions = el("div", { class: "agent-sheet__actions" }, [
    button("📷 建素材", () => {
      input.value = "把這張照片做成收費桌";
      void run();
    }, "chip"),
    button("🪑 幫我場佈", () => {
      input.value = "這裡放兩個報到桌";
      void run();
    }, "chip"),
    button("▶ 模擬活動", () => {
      input.value = "模擬 60 人進場";
      void run();
    }, "chip"),
    button("✨ 幫我優化", () => {
      input.value = "幫我改善，入口旁邊留 1 公尺不要擋門";
      void run();
    }, "chip"),
  ]);

  const runBtn = button("執行", () => void run(), "btn chip--primary");
  const closeBtn = button("關閉", () => close(), "chip");

  previewBar.append(
    el("div", { class: "agent-sheet__preview-label", text: "Preview 就緒" }),
    button("套用", () => {
      if (!app.quickAgent.isPreviewActive()) return;
      app.quickAgent.commit();
      app.applyAgentPreview(null);
      previewBar.style.display = "none";
      cards.append(el("div", { class: "agent-card", text: "已套用（可 Undo 還原）" }));
      app.notifyToast?.("已套用 AI 變更", true);
    }, "chip chip--primary"),
    button("取消", () => {
      app.quickAgent.rollback();
      app.applyAgentPreview(null);
      previewBar.style.display = "none";
      cards.append(el("div", { class: "agent-card", text: "已取消 Preview" }));
    }, "chip"),
  );

  body.append(
    el("div", { class: "agent-sheet__title", text: "✦ AI 幫我" }),
    el("p", { class: "hint", text: "一句話 → 工具操作 → Canvas Preview。不會直接亂改正式場佈。" }),
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
      last = await app.quickAgent.run({
        text,
        selectionIds: [...app.session.selection],
      });
      cards.innerHTML = "";
      for (const c of last.cards) {
        cards.append(
          el("div", { class: "agent-card" }, [
            el("div", { class: "agent-card__title", text: c.title }),
            el("div", { class: "agent-card__detail", text: c.detail }),
          ]),
        );
      }
      if (last.previewActive) {
        previewBar.style.display = "flex";
        app.applyAgentPreview(app.quickAgent.getDraftProject());
      }
    } catch (e) {
      cards.innerHTML = "";
      cards.append(
        el("div", {
          class: "agent-card",
          text: `失敗：${e instanceof Error ? e.message : String(e)}`,
        }),
      );
    }
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
  };
}
