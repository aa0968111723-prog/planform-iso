/**
 * Quick Start wizard — the first thing a new user sees.
 *
 * Two questions, zero engineering: 「今天要排什麼？」 pick a venue, then
 * 「這次活動需要什麼？」 tick needs + head count → a ready-to-edit plan.
 * Everything routes through core/quickStart.ts pure builders.
 */

import type { App } from "../app/App";
import type { ProjectSession } from "../state/projectSession";
import { buildE310GoldenProject, buildQuickStartProject, DEFAULT_NEEDS, type QuickStartNeeds } from "../core/quickStart";
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
  { key: "life", label: "🧺 生活組區" },
  { key: "shoe", label: "👟 鞋子區" },
  { key: "backpack", label: "🎒 背包區" },
  { key: "teacher", label: "🧘 講師區" },
  { key: "groups", label: "👥 小組區" },
  { key: "staffRoute", label: "🦺 工作人員動線" },
];

/**
 * Show the Quick Start overlay. Returns the overlay element.
 *
 * Everything this wizard produces is a NEW project. It used to replace the
 * open plan behind a confirm, which is the behaviour this whole change exists
 * to remove — and that confirm was also unsound: it only looked at zones,
 * objects, groups and routes, so a plan holding nothing but measurements and
 * scenarios was wiped with no prompt and no undo.
 */
export function showQuickStart(app: App, session: ProjectSession, onDone: () => void): HTMLElement {
  const overlay = el("div", { class: "quickstart" });
  const card = el("div", { class: "quickstart__card" });
  overlay.append(card);

  const close = (markDone: boolean) => {
    if (markDone) markSeen();
    overlay.remove();
    onDone();
  };

  /**
   * One wizard run creates exactly one project. Without this, a double tap on
   * 建立場佈 lands twice: the first call fills the pristine boot project, the
   * second no longer can (the id is spent) and mints a second, so the user
   * gets an extra card they never asked for.
   */
  let creating = false;
  const createOnce = (make: () => void): void => {
    if (creating) return;
    creating = true;
    make();
    app.notifyToast?.("場佈起點已建立，直接拖曳調整即可", false);
    close(true);
  };

  const renderVenueStep = (): void => {
    card.innerHTML = "";
    card.append(el("div", { class: "quickstart__title", text: "今天要排什麼？" }));
    card.append(el("p", { class: "hint", text: "選一個場地開始，之後所有尺寸都可以改。" }));
    const tku = BUILTIN_VENUE_PRESETS[0];
    const rect = BUILTIN_VENUE_PRESETS[1];
    const blank = BUILTIN_VENUE_PRESETS[2];
    const e310 = BUILTIN_VENUE_PRESETS.find((p) => p.id === "venue:tku-e310");
    if (e310) {
      card.append(
        button(`🎤 ${e310.name}`, () => renderNeedsStep(e310), "btn btn--big"),
        el("p", { class: "hint", text: e310.note }),
        button("⚡ E310 演講範例（60 人）", () => createOnce(() => {
          // `name` is deliberately omitted: the builder already names it, and
          // `createProject` falls back to the body's own name.
          session.createProject({
            project: buildE310GoldenProject(e310),
            open: true,
            adoptPristineActive: true,
          });
        }), "btn btn--big btn--primary"),
      );
    }
    card.append(
      button(`🏫 ${tku.name}`, () => renderNeedsStep(tku), "btn btn--big"),
      el("p", { class: "hint", text: tku.note }),
    );
    const saved = [...listUserVenuePresets()];
    if (saved.length) {
      card.append(button("📁 我的場地模板", () => renderMineStep(saved), "btn btn--big btn--ghost"));
    }
    card.append(
      button(`▭ ${rect.name}`, () => renderNeedsStep(rect), "btn btn--big btn--ghost"),
      button(`⬜ ${blank.name}`, () => renderNeedsStep(blank), "btn btn--big btn--ghost"),
      el("div", { class: "quickstart__foot" }, [
        button("直接進編輯器", () => close(true), "chip chip--sm"),
        button("🗂 我的專案", () => {
          close(true);
          session.goHome();
        }, "chip chip--sm"),
      ]),
    );
  };

  const renderMineStep = (venues: VenuePreset[]): void => {
    card.innerHTML = "";
    card.append(el("div", { class: "quickstart__title", text: "我的場地模板" }));
    card.append(el("p", { class: "hint", text: "只存場地和固定設施，不含場佈。" }));
    // Saved whole plans used to be offered here as 「已存的平面圖」. They are
    // projects now, promoted by the migration, and live in 我的專案.
    if (venues.length) {
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
    // E310 exists for one purpose — the club's real events there are lectures
    // with on-site payment, a teacher zone and a life-crew corner. Default the
    // ticks (and 60 people below) to that reality instead of a generic 30.
    const isE310 = venue.id === "venue:tku-e310";
    const needs: QuickStartNeeds = isE310
      ? { ...DEFAULT_NEEDS, payment: true, life: true, teacher: true }
      : { ...DEFAULT_NEEDS };
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
      value: isE310 ? "60" : "30",
      min: "1",
      max: "300",
      inputmode: "numeric",
    }) as HTMLInputElement;
    countRow.append(countInput);
    card.append(countRow);
    if (isE310) {
      card.append(el("p", { class: "hint", text: "已繳／現場繳的人數，之後在「▶ 模擬」裡填就可以。" }));
    }

    const aisleChip = button("✓ 留中央走道", () => {
      centralAisle = !centralAisle;
      aisleChip.textContent = `${centralAisle ? "✓ " : ""}留中央走道`;
      aisleChip.classList.toggle("chip--primary", centralAisle);
    }, "chip chip--primary");
    card.append(el("div", { class: "row" }, [aisleChip, el("span", { class: "hint", text: "地墊之間留 90cm 走道" })]));

    card.append(
      button("建立場佈", () => createOnce(() => {
        const participants = Math.max(1, Math.min(300, Number(countInput.value) || 30));
        const project = buildQuickStartProject({
          venue,
          eventName: nameInput.value.trim() || "未命名活動",
          participants,
          needs,
          centralAisle,
        });
        session.createProject({
          project,
          name: project.name,
          open: true,
          adoptPristineActive: true,
        });
      }), "btn btn--big btn--primary"),
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
