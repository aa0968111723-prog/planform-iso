/**
 * Quick Start wizard — the first thing a new user sees.
 *
 * Two questions, zero engineering: 「今天要排什麼？」 pick a venue, then
 * 「這次活動需要什麼？」 tick needs + head count → a ready-to-edit plan.
 * Everything routes through core/quickStart.ts pure builders.
 */

import type { App } from "../app/App";
import { buildQuickStartProject, DEFAULT_NEEDS, type QuickStartNeeds } from "../core/quickStart";
import { BUILTIN_VENUE_PRESETS, listUserVenuePresets, type VenuePreset } from "../core/venues";
import { button, el } from "./dom";

export const QUICKSTART_KEY = "planform-iso:quickstart";

export function quickStartSeen(): boolean {
  try {
    return !!localStorage.getItem(QUICKSTART_KEY);
  } catch {
    return true; // no storage → never block the app with a modal loop
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(QUICKSTART_KEY, "1");
  } catch {
    /* ignore */
  }
}

interface NeedOption {
  key: keyof QuickStartNeeds;
  label: string;
}

const NEED_OPTIONS: NeedOption[] = [
  { key: "mats", label: "🟪 地墊" },
  { key: "checkin", label: "👋 報到" },
  { key: "payment", label: "💰 收費" },
  { key: "shoe", label: "👟 鞋子區" },
  { key: "backpack", label: "🎒 背包區" },
  { key: "teacher", label: "🧘 講師區" },
  { key: "groups", label: "👥 小組區" },
  { key: "staffRoute", label: "🦺 工作人員動線" },
];

/** Show the Quick Start overlay. Returns the overlay element. */
export function showQuickStart(app: App, onDone: () => void): HTMLElement {
  const overlay = el("div", { class: "quickstart" });
  const card = el("div", { class: "quickstart__card" });
  overlay.append(card);

  const close = (markDone: boolean) => {
    if (markDone) markSeen();
    overlay.remove();
    onDone();
  };

  /** Loading a wizard result replaces the current plan — ask when it has content. */
  const confirmReplace = (): boolean => {
    const p = app.store.getState();
    const hasContent = p.objects.length > 0 || p.zones.length > 0 || p.groups.length > 0 || p.routes.length > 0;
    if (!hasContent) return true;
    return window.confirm("目前的場佈會被新的取代（建議先到「分享」把它存成平面圖）。確定繼續？");
  };

  const renderVenueStep = (): void => {
    card.innerHTML = "";
    card.append(el("div", { class: "quickstart__title", text: "今天要排什麼？" }));
    card.append(el("p", { class: "hint", text: "選一個場地開始，之後所有尺寸都可以改。" }));
    const tku = BUILTIN_VENUE_PRESETS[0];
    const rect = BUILTIN_VENUE_PRESETS[1];
    const blank = BUILTIN_VENUE_PRESETS[2];
    card.append(
      button(`🏫 ${tku.name}`, () => renderNeedsStep(tku), "btn btn--big"),
      el("p", { class: "hint", text: tku.note }),
    );
    const saved = [...listUserVenuePresets()];
    const layouts = app.store.listLayouts();
    if (saved.length || layouts.length) {
      card.append(button("📁 使用我之前的場地", () => renderMineStep(saved, layouts), "btn btn--big btn--ghost"));
    }
    card.append(
      button(`▭ ${rect.name}`, () => renderNeedsStep(rect), "btn btn--big btn--ghost"),
      button(`⬜ ${blank.name}`, () => renderNeedsStep(blank), "btn btn--big btn--ghost"),
      el("div", { class: "quickstart__foot" }, [
        button("直接進編輯器", () => close(true), "chip chip--sm"),
      ]),
    );
  };

  const renderMineStep = (venues: VenuePreset[], layouts: string[]): void => {
    card.innerHTML = "";
    card.append(el("div", { class: "quickstart__title", text: "我的場地" }));
    if (layouts.length) {
      card.append(el("div", { class: "subhead", text: "已存的平面圖（直接載入整份場佈）" }));
      for (const name of layouts) {
        card.append(button(`📄 ${name}`, () => {
          if (!confirmReplace()) return;
          app.store.loadNamedLayout(name);
          app.recenterView();
          close(true);
        }, "btn btn--ghost"));
      }
    }
    if (venues.length) {
      card.append(el("div", { class: "subhead", text: "我的場地模板（只有場地，重新排場佈）" }));
      for (const v of venues) {
        card.append(button(`🏫 ${v.name}`, () => renderNeedsStep(v), "btn btn--ghost"));
      }
    }
    card.append(el("div", { class: "quickstart__foot" }, [
      button("← 返回", () => renderVenueStep(), "chip chip--sm"),
    ]));
  };

  const renderNeedsStep = (venue: VenuePreset): void => {
    card.innerHTML = "";
    const needs: QuickStartNeeds = { ...DEFAULT_NEEDS };
    let centralAisle = true;
    card.append(el("div", { class: "quickstart__title", text: "這次活動需要什麼？" }));
    card.append(el("p", { class: "hint", text: `場地：${venue.name}（之後可改）` }));

    const nameInput = el("input", {
      type: "text",
      class: "field__input",
      placeholder: "活動名稱（例如：期初茶會）",
    }) as HTMLInputElement;
    card.append(nameInput);

    const grid = el("div", { class: "quickstart__needs" });
    for (const optDef of NEED_OPTIONS) {
      const chip = button(
        `${needs[optDef.key] ? "✓ " : ""}${optDef.label}`,
        () => {
          needs[optDef.key] = !needs[optDef.key];
          chip.textContent = `${needs[optDef.key] ? "✓ " : ""}${optDef.label}`;
          chip.classList.toggle("chip--primary", needs[optDef.key]);
        },
        `chip ${needs[optDef.key] ? "chip--primary" : ""}`,
      );
      grid.append(chip);
    }
    card.append(grid);

    const countRow = el("div", { class: "row" });
    countRow.append(el("span", { class: "field__label", text: "參加人數" }));
    const countInput = el("input", {
      type: "number",
      class: "field__input",
      value: "30",
      min: "1",
      max: "300",
      inputmode: "numeric",
    }) as HTMLInputElement;
    countRow.append(countInput);
    card.append(countRow);

    const aisleChip = button("✓ 留中央走道", () => {
      centralAisle = !centralAisle;
      aisleChip.textContent = `${centralAisle ? "✓ " : ""}留中央走道`;
      aisleChip.classList.toggle("chip--primary", centralAisle);
    }, "chip chip--primary");
    card.append(el("div", { class: "row" }, [aisleChip, el("span", { class: "hint", text: "地墊之間留 90cm 走道" })]));

    card.append(
      button("建立場佈", () => {
        if (!confirmReplace()) return;
        const participants = Math.max(1, Math.min(300, Number(countInput.value) || 30));
        const project = buildQuickStartProject({
          venue,
          eventName: nameInput.value.trim() || "未命名活動",
          participants,
          needs,
          centralAisle,
        });
        app.startFromQuickStart(project);
        close(true);
      }, "btn btn--big btn--primary"),
      el("div", { class: "quickstart__foot" }, [
        button("← 返回", () => renderVenueStep(), "chip chip--sm"),
      ]),
    );
  };

  renderVenueStep();
  // A tap outside dismisses WITHOUT marking "seen": an accidental tap on the
  // first run should not hide the wizard forever.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close(false);
  });
  return overlay;
}
