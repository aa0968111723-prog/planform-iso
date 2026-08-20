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
import { buildQuickStartProject, DEFAULT_NEEDS, type QuickStartNeeds } from "../core/quickStart";
import { venuePresetById, venuePresetFromProject } from "../core/venues";
import { button, el } from "./dom";

export interface QuickAgentSheetHandles {
  root: HTMLElement;
  previewRoot: HTMLElement;
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
  const root = el("div", { class: "agent-sheet-host" });
  const sheet = el("div", { class: "agent-sheet", style: "display:none" });
  root.append(sheet);
  const body = el("div", { class: "agent-sheet__body" });
  const input = el("textarea", {
    class: "field__input agent-sheet__input",
    placeholder: "例如：30 人社課，中間留走道",
    rows: "2",
  }) as HTMLTextAreaElement;
  const cards = el("div", { class: "agent-sheet__cards" });
  const previewBar = el("div", { class: "agent-preview-bar", style: "display:none" });

  // Shortcut chips keep the canonical 幫我◯◯ names (spec §6); honesty about
  // "this just takes you there" lives in the follow-up toast, not a renamed
  // label. 幫我排場佈 runs the real quick-start-equivalent preview.
  const jump = (fn?: () => void, note?: string) => () => {
    close();
    fn?.();
    if (note) app.notifyToast?.(note);
  };

  const actions = el("div", { class: "agent-sheet__actions" }, [
    button("🪑 幫我排場佈", () => void previewQuickStart(), "chip"),
    button("🟪 幫我排地墊", jump(hooks.openMatArranger, "已打開排地墊：選人數就出 A/B/C 方案"), "chip"),
    button("🚶 幫我畫動線", jump(hooks.startEntryRoute), "chip"),
    button("🔍 幫我檢查", jump(hooks.openCheck, "檢查結果在「分享」頁最上面"), "chip"),
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
  sheet.append(body);
  root.append(previewBar);

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
            el("div", { class: "agent-card__detail", text: humanizeDetail(c.detail) }),
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

  function humanizeDetail(detail: string): string {
    return detail
      .replace(/Validation/g, "檢查")
      .replace(/error/gi, "錯誤")
      .replace(/warning/gi, "提醒")
      .replace(/tool/gi, "操作");
  }

  function open(preset?: string): void {
    sheet.style.display = "block";
    if (preset) input.value = preset;
    // On a phone the keyboard must not cover the sheet before the user chooses
    // an action. Desktop keeps the convenient focus behaviour.
    if (window.matchMedia?.("(min-width: 601px)").matches) input.focus();
  }

  function close(): void {
    if (app.quickAgent.isPreviewActive()) {
      app.quickAgent.rollback();
      app.applyAgentPreview(null);
      previewBar.style.display = "none";
    }
    sheet.style.display = "none";
  }

  function previewQuickStart(): void {
    const current = app.store.getState();
    const venue = (current.venuePresetId ? venuePresetById(current.venuePresetId) : null)
      ?? venuePresetFromProject(current, current.name || "目前場地");
    const has = (type: QuickStartNeeds["mats"] extends boolean ? string : never) =>
      current.zones.some((z) => z.type === type) || current.objects.some((o) => o.serviceRole === type);
    const needs: QuickStartNeeds = {
      ...DEFAULT_NEEDS,
      mats: current.groups.some((g) => g.sourceKind === "mat") || DEFAULT_NEEDS.mats,
      checkin: true,
      payment: has("payment"),
      shoe: current.zones.some((z) => z.type === "shoe") || DEFAULT_NEEDS.shoe,
      backpack: current.zones.some((z) => z.type === "backpack") || DEFAULT_NEEDS.backpack,
      life: current.zones.some((z) => z.type === "life"),
      teacher: current.zones.some((z) => z.type === "meditation"),
      groups: current.zones.some((z) => z.type === "group"),
      staffRoute: current.routes.some((r) => r.type === "staff"),
    };
    const generated = buildQuickStartProject({
      venue,
      eventName: current.name,
      participants: Math.max(1, app.session.participants),
      needs,
      centralAisle: true,
    });
    const draft = structuredClone(current);
    const hasCheckinDesk = current.objects.some((o) => o.kind === "regTable" || o.serviceRole === "checkin");
    const hasPaymentDesk = current.objects.some((o) => o.serviceRole === "payment");
    const hasMatGroup = current.groups.some((g) => g.sourceKind === "mat");
    for (const z of generated.zones) if (!draft.zones.some((x) => x.type === z.type)) draft.zones.push(z);
    for (const o of generated.objects) {
      if (o.kind === "door" || o.kind === "screen" || o.assetId === "builtin:stage-platform" || o.assetId === "builtin:lectern") continue;
      if (o.serviceRole === "checkin" && hasCheckinDesk) continue;
      if (o.serviceRole === "payment" && hasPaymentDesk) continue;
      draft.objects.push(o);
    }
    if (!hasMatGroup) draft.groups.push(...generated.groups);
    for (const route of generated.routes) if (!draft.routes.some((r) => r.type === route.type)) draft.routes.push(route);
    app.quickAgent.tx.start(current);
    app.quickAgent.tx.mutate((p) => Object.assign(p, draft));
    app.applyAgentPreview(app.quickAgent.getDraftProject());
    cards.innerHTML = "";
    cards.append(el("div", { class: "agent-card", text: "已讀取目前場地，補上缺少的區域與動線；已有報到桌不會重複放。請先看預覽。" }));
    previewBar.style.display = "flex";
  }

  return {
    root,
    previewRoot: root,
    open,
    close,
    isOpen: () => sheet.style.display !== "none",
    runPreset: (text: string) => {
      open(text);
      void run();
    },
  };
}
