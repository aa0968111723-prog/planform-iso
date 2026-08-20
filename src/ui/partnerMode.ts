/**
 * Partner Mode shell — the view a volunteer sees the first time, with no
 * training.
 *
 * Design rules enforced here:
 *   - the canvas is the page; chrome is two thin strips (top identity + role,
 *     bottom briefing + actions) and never a sidebar, at any width;
 *   - nothing numeric or spatial leaks through — no centimetres, no X/Z, no
 *     snapping, no inspector, no advanced parameters;
 *   - every panel is reachable in one tap and dismissable in one tap.
 */

import type { App } from "../app/App";
import { PARTNER_ROLES, type PartnerRole } from "../core/partner";
import { formatDuration, type RehearsalEvent } from "../core/rehearsal";
import { renderConstructionPlan } from "../export/constructionPlan";
import { pngFilename, sharePng } from "../export/exporters";
import { button, el } from "./dom";

export type PartnerSheet = "none" | "steps" | "timeline" | "suggest" | "marks";

export interface PartnerModeHandles {
  /** Top strip: project name, traffic light, exit. */
  top: HTMLElement;
  /** Bottom strip: briefing + the three things a partner can do. */
  dock: HTMLElement;
  /** Overlay sheet for steps / rehearsal / AI suggestion. */
  sheet: HTMLElement;
  update(): void;
  openSheet(kind: PartnerSheet): void;
  closeSheet(): void;
  currentSheet(): PartnerSheet;
}

const TONE_LIGHT: Record<string, { dot: string; cls: string }> = {
  bad: { dot: "🔴", cls: "light--bad" },
  warn: { dot: "🟠", cls: "light--warn" },
  ok: { dot: "🟢", cls: "light--ok" },
};

export function buildPartnerMode(
  app: App,
  opts: { onExit: () => void; onLayoutChange: () => void },
): PartnerModeHandles {
  const title = el("div", { class: "partnerbar__title" });
  const light = el("button", { type: "button", class: "partnerbar__light" }) as HTMLButtonElement;
  light.addEventListener("click", () => openSheet(sheetKind === "marks" ? "none" : "marks"));
  const roles = el("div", { class: "partnerroles" });
  const top = el("header", { class: "partnertop" }, [
    el("div", { class: "partnerbar" }, [
      title,
      light,
      button("離開", () => opts.onExit(), "chip chip--sm partnerbar__exit"),
    ]),
    roles,
  ]);

  const brief = el("button", { type: "button", class: "partnerbrief" }) as HTMLButtonElement;
  brief.addEventListener("click", () => openSheet(sheetKind === "steps" ? "none" : "steps"));
  const actions = el("div", { class: "partneractions" }, [
    button("▶ 演練一次", () => {
      app.runRehearsal();
      openSheet("timeline");
    }, "btn partneraction"),
    button("✦ 更順的排法", () => {
      void app.requestPartnerSuggestion();
      openSheet("suggest");
    }, "btn partneraction partneraction--accent"),
    button("🖼 存成圖", () => {
      const state = app.store.getState();
      const dataUrl = renderConstructionPlan(state, { preset: "partner", simplify: true, dims: false, inventory: false });
      void sharePng(dataUrl, pngFilename(state.name, "夥伴觀看圖")).then((how) => {
        if (how !== "cancelled") app.notifyToast?.(how === "shared" ? "已開啟分享（可直接傳 LINE）" : "圖片已下載");
      });
    }, "btn partneraction"),
  ]);
  const dock = el("div", { class: "partnerdock" }, [brief, actions]);

  const sheetTitle = el("div", { class: "partnersheet__title" });
  const sheetBody = el("div", { class: "partnersheet__body" });
  // Decisions live outside the scroll area so they are always one tap away,
  // however long the comparison gets.
  const sheetFoot = el("div", { class: "partnersheet__actions", style: "display:none" });
  const sheet = el("div", { class: "partnersheet", style: "display:none" }, [
    el("div", { class: "partnersheet__handle" }, [el("span", { class: "sheet-handle__grip" })]),
    el("div", { class: "partnersheet__head" }, [
      sheetTitle,
      button("收起", () => closeSheet(), "chip chip--sm"),
    ]),
    sheetBody,
    sheetFoot,
  ]);
  sheet.querySelector(".partnersheet__handle")?.addEventListener("click", () => closeSheet());

  let sheetKind: PartnerSheet = "none";

  function openSheet(kind: PartnerSheet): void {
    sheetKind = kind;
    render();
    opts.onLayoutChange();
  }
  function closeSheet(): void {
    openSheet("none");
  }

  // --- role chips ---------------------------------------------------------

  for (const role of PARTNER_ROLES) {
    const chip = el("button", { type: "button", class: "rolechip", "data-role": role.id }, [
      el("span", { class: "rolechip__icon", text: role.icon }),
      el("span", { class: "rolechip__label", text: role.label }),
    ]) as HTMLButtonElement;
    chip.addEventListener("click", () => {
      app.setPartnerRole(role.id as PartnerRole);
      if (sheetKind === "timeline" || sheetKind === "suggest") return;
      openSheet("none");
    });
    roles.append(chip);
  }

  // --- rendering ----------------------------------------------------------

  function renderBrief(): void {
    const b = app.partnerBriefing();
    brief.innerHTML = "";
    if (b.emptyHint) {
      brief.append(el("span", { class: "partnerbrief__line", text: b.emptyHint }));
      return;
    }
    const lines: { icon: string; text: string }[] = [];
    if (b.youAre) lines.push({ icon: "📍", text: `你在「${b.youAre}」` });
    if (b.peopleComeFrom) lines.push({ icon: "⬅️", text: `人從「${b.peopleComeFrom}」來` });
    if (b.nextStop) lines.push({ icon: "➡️", text: `再往「${b.nextStop}」` });
    if (!lines.length) {
      lines.push({ icon: "👀", text: `整場流程共 ${b.steps.length} 步，點我看順序` });
    }
    for (const line of lines) {
      brief.append(el("span", { class: "partnerbrief__line" }, [
        el("span", { class: "partnerbrief__icon", text: line.icon }),
        el("span", { text: line.text }),
      ]));
    }
    brief.append(el("span", { class: "partnerbrief__more", text: sheetKind === "steps" ? "收起 ▾" : "看步驟 ▸" }));
    brief.append(el("span", {
      class: "partnerbrief__journey",
      text: `上一站：${b.peopleComeFrom ?? "入口"} → 你：${b.youAre ?? "目前沒有指定站點"} → 下一站：${b.nextStop ?? "座區結束"}`,
    }));
  }

  function renderSteps(): void {
    const b = app.partnerBriefing();
    sheetTitle.textContent = `${b.icon} ${b.title}：怎麼做`;
    sheetBody.innerHTML = "";
    if (!b.steps.length) {
      sheetBody.append(el("p", { class: "partnerempty", text: b.emptyHint ?? "還沒有安排這個角色。" }));
      return;
    }
    const list = el("ol", { class: "partnersteps" });
    for (const step of b.steps) {
      list.append(el("li", { class: "partnerstep" }, [
        el("span", { class: "partnerstep__no", text: String(step.index) }),
        el("span", { text: step.text }),
      ]));
    }
    sheetBody.append(list);
  }

  function renderMarks(): void {
    sheetTitle.textContent = "🚦 場地上要注意的地方";
    sheetBody.innerHTML = "";
    const marks = app.partnerMarks();
    if (!marks.length) {
      sheetBody.append(el("p", { class: "partnerempty", text: "目前沒有要注意的地方，動線是順的。" }));
      return;
    }
    const list = el("div", { class: "marklist" });
    for (const mark of marks) {
      list.append(el("div", { class: `markrow markrow--${mark.tone}` }, [
        el("span", { class: "markrow__dot", text: mark.tone === "bad" ? "🔴" : mark.tone === "warn" ? "🟠" : "🟢" }),
        el("span", {}, [
          el("strong", { text: mark.text }),
          el("div", { class: "markrow__action", text: mark.action }),
        ]),
      ]));
    }
    sheetBody.append(list, el("p", { class: "partnerempty", text: "場地圖上同色的標記就是這些位置。" }));
  }

  function renderTimeline(): void {
    sheetTitle.textContent = "🕐 演練：現場會這樣跑";
    sheetBody.innerHTML = "";
    const timeline: RehearsalEvent[] = app.session.partner?.timeline ?? [];
    if (!timeline.length) {
      sheetBody.append(el("p", { class: "partnerempty", text: "按「▶ 演練一次」就會看到現場的時間軸。" }));
      return;
    }
    const result = app.session.simResult;
    if (result) {
      sheetBody.append(el("p", { class: "partnerempty", text: `這一輪 ${formatDuration(result.finishTimeSeconds)} 全部就位。` }));
    }
    const list = el("div", { class: "timeline" });
    for (const ev of timeline) {
      list.append(el("div", { class: `timeline__row timeline__row--${ev.tone}` }, [
        el("span", { class: "timeline__clock", text: ev.clock }),
        el("span", { class: "timeline__icon", text: ev.icon }),
        el("span", { class: "timeline__text", text: ev.text }),
      ]));
    }
    sheetBody.append(list);
  }

  function renderSuggest(): void {
    sheetTitle.textContent = "✦ 現在的排法 vs 建議排法";
    sheetBody.innerHTML = "";
    const partner = app.session.partner;
    if (partner?.busy) {
      sheetBody.append(el("p", { class: "partnerempty", text: "正在幫你想更順的排法…" }));
      return;
    }
    const s = partner?.suggestion;
    if (!s) {
      sheetBody.append(el("p", { class: "partnerempty", text: "目前沒有更好的建議，維持現在的排法就好。" }));
      return;
    }
    const shot = (project: Parameters<typeof renderConstructionPlan>[0]) =>
      renderConstructionPlan(project, { preset: "full", simplify: true, dims: false, inventory: false, scale: 1 });

    sheetBody.append(
      el("div", { class: "beforeafter" }, [
        el("figure", { class: "beforeafter__side" }, [
          el("figcaption", { class: "beforeafter__cap", text: "現在的排法" }),
          el("img", { class: "beforeafter__img", src: shot(app.store.getState()), alt: "現在的排法" }),
        ]),
        el("figure", { class: "beforeafter__side beforeafter__side--after" }, [
          el("figcaption", { class: "beforeafter__cap", text: "建議的排法" }),
          el("img", { class: "beforeafter__img", src: shot(s.afterProject), alt: "建議的排法" }),
        ]),
      ]),
      el("div", { class: "comparerows" }, s.comparison.rows.map((row) =>
        el("div", { class: `comparerow comparerow--${row.delta}` }, [
          el("span", { class: "comparerow__label", text: row.label }),
          el("span", { class: "comparerow__before", text: row.before }),
          el("span", { class: "comparerow__arrow", text: "→" }),
          el("span", { class: "comparerow__after", text: row.after }),
        ]))),
      el("p", { class: "partnerverdict", text: s.comparison.verdict }),
    );
    sheetFoot.innerHTML = "";
    sheetFoot.style.display = "flex";
    sheetFoot.append(
      button("用建議的排法", () => { app.applyPartnerSuggestion(); closeSheet(); },
        s.comparison.suggestionWins ? "btn chip--primary" : "btn btn--ghost"),
      button("保持現在的", () => { app.dismissPartnerSuggestion(); closeSheet(); }, "btn btn--ghost"),
    );
  }

  function render(): void {
    const state = app.store.getState();
    const role = app.session.partner?.role ?? "all";
    title.textContent = state.name || "活動場佈";

    const status = app.partnerStatus();
    const tone = TONE_LIGHT[status.tone] ?? TONE_LIGHT.ok;
    light.className = `partnerbar__light ${tone.cls}`;
    light.textContent = `${tone.dot} ${status.text}`;

    roles.querySelectorAll<HTMLButtonElement>(".rolechip").forEach((chip) =>
      chip.setAttribute("aria-pressed", String(chip.dataset.role === role)));

    renderBrief();

    sheet.style.display = sheetKind === "none" ? "none" : "flex";
    sheetFoot.style.display = "none";
    if (sheetKind === "steps") renderSteps();
    else if (sheetKind === "marks") renderMarks();
    else if (sheetKind === "timeline") renderTimeline();
    else if (sheetKind === "suggest") renderSuggest();

    // Keep the action labels short enough to stay on one row on a phone; the
    // rehearsal figure belongs in the timeline, not on the button.
    const hint = actions.querySelector(".partneraction");
    if (hint instanceof HTMLElement) {
      hint.textContent = app.session.simResult ? "▶ 再演練一次" : "▶ 演練一次";
    }
  }

  return {
    top,
    dock,
    sheet,
    update: render,
    openSheet,
    closeSheet,
    currentSheet: () => sheetKind,
  };
}
