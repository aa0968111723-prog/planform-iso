/**
 * New-project wizard.
 *
 * This used to be a first-run "Quick Start" that built a plan and **replaced**
 * whatever was on screen. That made the app single-plan by construction: there
 * was no way to keep 「期初茶會」 and 「9/24 社課」 at the same time.
 *
 * It is now the front door of Project Home: name the event, pick a venue, tick
 * what it needs — and the result becomes a brand new project with its own id.
 * Nothing existing is touched.
 *
 * Note what is deliberately *not* here any more: saved 平面圖 (named layouts).
 * A layout is a snapshot inside one project, not another project, and listing
 * them next to venues was what made the two concepts blur together.
 */

import type { Project } from "../core/model";
import { buildE310GoldenProject, buildQuickStartProject, DEFAULT_NEEDS, type QuickStartNeeds } from "../core/quickStart";
import { BUILTIN_VENUE_PRESETS, listUserVenuePresets, type VenuePreset } from "../core/venues";
import { button, el } from "./dom";

export interface NewProjectResult {
  name: string;
  project: Project;
  venue: VenuePreset;
  participants: number;
}

export interface NewProjectWizardOptions {
  onCreate: (result: NewProjectResult) => void;
  /** Called when the user backs out without creating anything. */
  onCancel: () => void;
  /** Suggested name, e.g. derived from today's date. */
  suggestedName?: string;
}

interface NeedOption {
  key: keyof QuickStartNeeds;
  label: string;
}

const NEED_OPTIONS: NeedOption[] = [
  { key: "mats", label: "🧩 地墊" },
  { key: "checkin", label: "👋 報到" },
  { key: "payment", label: "💰 收費" },
  { key: "life", label: "🧺 生活組區" },
  { key: "shoe", label: "👟 鞋子區" },
  { key: "backpack", label: "🎒 背包區" },
  { key: "teacher", label: "🧘 講師區" },
  { key: "groups", label: "👥 小組區" },
  { key: "staffRoute", label: "🦺 工作人員動線" },
];

/** "9/24 活動" — a starting point the user will usually replace. */
export function suggestProjectName(now = new Date()): string {
  return `${now.getMonth() + 1}/${now.getDate()} 活動`;
}

/**
 * Show the new-project wizard. Returns the overlay element; the caller mounts
 * it and it removes itself on completion or cancel.
 */
export function showNewProjectWizard(opts: NewProjectWizardOptions): HTMLElement {
  const overlay = el("div", { class: "quickstart" });
  const card = el("div", { class: "quickstart__card" });
  overlay.append(card);

  let projectName = opts.suggestedName ?? suggestProjectName();

  const finish = (result: NewProjectResult): void => {
    overlay.remove();
    opts.onCreate(result);
  };

  const cancel = (): void => {
    overlay.remove();
    opts.onCancel();
  };

  const stepHead = (step: number, title: string, sub?: string): HTMLElement[] => [
    el("div", { class: "quickstart__step", text: `第 ${step} 步 / 共 3 步` }),
    el("div", { class: "quickstart__title", text: title }),
    ...(sub ? [el("p", { class: "hint", text: sub })] : []),
  ];

  // --- step 1: name ------------------------------------------------------

  const renderNameStep = (): void => {
    card.innerHTML = "";
    card.append(...stepHead(1, "這場活動叫什麼？", "之後可以改。取一個你在 LINE 上認得出來的名字。"));

    const input = el("input", {
      type: "text",
      class: "field__input quickstart__name",
      value: projectName,
      placeholder: "例如：9/24 禪學社社課",
      "aria-label": "專案名稱",
    }) as HTMLInputElement;
    card.append(input);

    const next = (): void => {
      projectName = input.value.trim() || suggestProjectName();
      renderVenueStep();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") next();
    });

    card.append(
      button("下一步：選場地", next, "btn btn--big btn--primary"),
      el("div", { class: "quickstart__foot" }, [button("取消", cancel, "chip chip--sm")]),
    );
    // Focus without scrolling the overlay on a phone.
    setTimeout(() => input.focus({ preventScroll: true }), 0);
  };

  // --- step 2: venue -----------------------------------------------------

  const renderVenueStep = (): void => {
    card.innerHTML = "";
    card.append(...stepHead(2, "在哪裡辦？", `專案：${projectName}`));

    const tku = BUILTIN_VENUE_PRESETS.find((p) => p.id === "venue:tku-classroom") ?? BUILTIN_VENUE_PRESETS[0];
    const rect = BUILTIN_VENUE_PRESETS.find((p) => p.id === "venue:rect-classroom");
    const blank = BUILTIN_VENUE_PRESETS.find((p) => p.id === "venue:blank");
    const e310 = BUILTIN_VENUE_PRESETS.find((p) => p.id === "venue:tku-e310");

    if (e310) {
      card.append(
        button(`🎤 ${e310.name}`, () => renderNeedsStep(e310), "btn btn--big"),
        el("p", { class: "hint", text: e310.note }),
        button("⚡ 直接用 E310 演講範例（60 人）", () => {
          finish({
            name: projectName,
            project: buildE310GoldenProject(e310),
            venue: e310,
            participants: 60,
          });
        }, "btn btn--big btn--primary"),
      );
    }
    card.append(
      button(`🏫 ${tku.name}`, () => renderNeedsStep(tku), "btn btn--big"),
      el("p", { class: "hint", text: tku.note }),
    );

    const saved = listUserVenuePresets();
    if (saved.length) {
      card.append(button("📁 我的場地", () => renderMineStep(saved), "btn btn--big btn--ghost"));
    }
    if (rect) card.append(button(`▭ ${rect.name}`, () => renderNeedsStep(rect), "btn btn--big btn--ghost"));
    if (blank) card.append(button(`⬜ ${blank.name}`, () => renderNeedsStep(blank), "btn btn--big btn--ghost"));

    card.append(el("div", { class: "quickstart__foot" }, [
      button("← 上一步", renderNameStep, "chip chip--sm"),
      button("取消", cancel, "chip chip--sm"),
    ]));
  };

  const renderMineStep = (venues: VenuePreset[]): void => {
    card.innerHTML = "";
    card.append(...stepHead(2, "我的場地", "你自己存過的場地尺寸。"));
    for (const v of venues) {
      card.append(button(`🏫 ${v.name}`, () => renderNeedsStep(v), "btn btn--ghost"));
    }
    card.append(el("div", { class: "quickstart__foot" }, [
      button("← 上一步", renderVenueStep, "chip chip--sm"),
    ]));
  };

  // --- step 3: needs + head count ---------------------------------------

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

    card.append(...stepHead(3, "這次活動需要什麼？", `${projectName} · ${venue.name}（之後都能改）`));

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

    const countInput = el("input", {
      type: "number",
      class: "field__input",
      value: isE310 ? "60" : "30",
      min: "1",
      max: "300",
      inputmode: "numeric",
      "aria-label": "參加人數",
    }) as HTMLInputElement;
    card.append(el("div", { class: "row" }, [
      el("span", { class: "field__label", text: "參加人數" }),
      countInput,
    ]));
    if (isE310) {
      card.append(el("p", { class: "hint", text: "已繳／現場繳的人數，之後在「▶ 模擬」裡填就可以。" }));
    }

    const aisleChip = button("✓ 留中央走道", () => {
      centralAisle = !centralAisle;
      aisleChip.textContent = `${centralAisle ? "✓ " : ""}留中央走道`;
      aisleChip.classList.toggle("chip--primary", centralAisle);
    }, "chip chip--primary");
    card.append(el("div", { class: "row" }, [
      aisleChip,
      el("span", { class: "hint", text: "地墊之間留 90cm 走道" }),
    ]));

    card.append(
      button("建立專案", () => {
        const participants = Math.max(1, Math.min(300, Number(countInput.value) || 30));
        finish({
          name: projectName,
          participants,
          venue,
          project: buildQuickStartProject({
            venue,
            eventName: projectName,
            participants,
            needs,
            centralAisle,
          }),
        });
      }, "btn btn--big btn--primary"),
      el("div", { class: "quickstart__foot" }, [
        button("← 上一步", renderVenueStep, "chip chip--sm"),
        button("取消", cancel, "chip chip--sm"),
      ]),
    );
  };

  renderNameStep();
  // A tap on the backdrop is a cancel, never a silent create.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cancel();
  });
  return overlay;
}
