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
import { FRESHMAN_LAYERS, freshmanBriefLines } from "../core/freshman";
import { resolveProjectPlace } from "../core/campusGuide";
import { buildingByCode, placeById, type TkuCampusId } from "../core/tkuCampus";
import { formatDuration, type RehearsalEvent } from "../core/rehearsal";
import { renderConstructionPlan } from "../export/constructionPlan";
import { pngFilename, sharePng } from "../export/exporters";
import { calibrationPendingLabels, venueNeedsCalibration } from "../core/model";
import { button, el } from "./dom";
import { buildCampusMap, type CampusMapHandles } from "./campusMap";

export type PartnerSheet = "none" | "steps" | "timeline" | "suggest" | "marks" | "station" | "photos";

export interface PartnerModeHandles {
  /** Top strip: project name, traffic light, exit. */
  top: HTMLElement;
  /** Bottom strip: briefing + the three things a partner can do. */
  dock: HTMLElement;
  /** Overlay sheet for steps / rehearsal / AI suggestion. */
  sheet: HTMLElement;
  map: HTMLElement;
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
  const layers = el("div", { class: "freshmanlayers", role: "tablist", "aria-label": "新生導覽" });
  const roles = el("div", { class: "partnerroles" });
  const splitBtn = button("分割", () => {
    const p = app.session.partner;
    if (p) app.setPartnerSplit(!p.splitView);
  }, "chip chip--sm partnerbar__split");
  const top = el("header", { class: "partnertop" }, [
    el("div", { class: "partnerbar" }, [
      title,
      light,
      splitBtn,
      button("離開", () => opts.onExit(), "chip chip--sm partnerbar__exit"),
    ]),
    layers,
    roles,
  ]);

  const brief = el("button", { type: "button", class: "partnerbrief" }) as HTMLButtonElement;
  brief.addEventListener("click", () => openSheet(sheetKind === "steps" ? "none" : "steps"));
  const actions = el("div", { class: "partneractions" });
  const dock = el("div", { class: "partnerdock" }, [brief, actions]);

  const sheetTitle = el("div", { class: "partnersheet__title" });
  const sheetBody = el("div", { class: "partnersheet__body" });
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
  let shownTap = 0;
  let mapCampus: TkuCampusId = "tamsui";
  let mapCampusTouched = false;

  const campusMap: CampusMapHandles = buildCampusMap({
    onEnterIndoor: () => app.setPartnerLayer("indoor"),
    onPreviewPlace: (placeId) => {
      const place = placeById(placeId);
      if (place && place.campusId !== "cyber") {
        mapCampus = place.campusId;
        app.setPartnerLayer(place.floor != null ? "classroom" : "building");
      }
    },
    onPreviewBuilding: (code) => {
      const building = buildingByCode(code);
      if (building && building.campusId !== "cyber") mapCampus = building.campusId;
      app.setPartnerLayer("building");
    },
    onCampus: (id) => {
      mapCampus = id;
      mapCampusTouched = true;
      app.setPartnerLayer("campus");
    },
  });

  function openSheet(kind: PartnerSheet): void {
    sheetKind = kind;
    render();
    opts.onLayoutChange();
  }
  function closeSheet(): void {
    if (app.session.partner) app.session.partner.stationObjectId = null;
    shownTap = app.session.partner?.stationTap ?? 0;
    openSheet("none");
  }

  for (const layer of FRESHMAN_LAYERS) {
    const chip = el("button", { type: "button", class: "layerchip", "data-layer": layer.id, role: "tab" }, [
      el("span", { class: "layerchip__icon", text: layer.icon }),
      el("span", { class: "layerchip__label", text: layer.label }),
    ]) as HTMLButtonElement;
    chip.addEventListener("click", () => app.setPartnerLayer(layer.id));
    layers.append(chip);
  }

  for (const role of PARTNER_ROLES) {
    const chip = el("button", { type: "button", class: "rolechip", "data-role": role.id }, [
      el("span", { class: "rolechip__icon", text: role.icon }),
      el("span", { class: "rolechip__label", text: role.label }),
    ]) as HTMLButtonElement;
    chip.addEventListener("click", () => {
      app.setPartnerRole(role.id as PartnerRole);
      if (sheetKind === "steps" || sheetKind === "timeline" || sheetKind === "suggest") return;
      openSheet("none");
    });
    roles.append(chip);
  }

  function isFreshman(): boolean {
    return app.session.partner?.audience === "freshman";
  }

  function showMap(): boolean {
    const p = app.session.partner;
    if (!p) return false;
    if (p.splitView) return true;
    return p.layer !== "indoor";
  }

  function renderBrief(): void {
    const freshman = isFreshman();
    brief.innerHTML = "";
    if (freshman) {
      const g = app.freshmanGuide();
      const layer = app.session.partner?.layer ?? "campus";
      for (const row of freshmanBriefLines(g, layer)) {
        brief.append(el("span", { class: "partnerbrief__line" }, [
          el("span", { class: "partnerbrief__icon", text: row.icon }),
          el("span", { text: `${row.label}：${row.text}` }),
        ]));
      }
      brief.append(el("span", { class: "partnerbrief__more", text: sheetKind === "steps" ? "收起 ▾" : "看步驟 ▸" }));
      return;
    }
    const b = app.partnerBriefing();
    const role = app.session.partner?.role ?? "all";
    if (b.emptyHint) {
      brief.append(el("span", { class: "partnerbrief__line", text: b.emptyHint }));
      return;
    }
    const lines: { icon: string; text: string }[] = [];
    if (b.youAre) lines.push({ icon: "📍", text: `你在「${b.youAre}」` });
    if (role === "all" && b.flowSummary) {
      lines.push({ icon: "➡️", text: `整體流程：${b.flowSummary}` });
    } else {
      if (b.peopleComeFrom) lines.push({ icon: "⬅️", text: `人從「${b.peopleComeFrom}」來` });
      if (b.nextStop) lines.push({ icon: "➡️", text: `再往「${b.nextStop}」` });
    }
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
      text: role === "all"
        ? `整體流程：${b.flowSummary ?? "依現場動線前進"}`
        : `上一站：${b.peopleComeFrom ?? "入口"} → 你：${b.youAre ?? "目前沒有指定站點"} → 下一站：${b.nextStop ?? "座區結束"}`,
    }));
  }

  function sharePartnerImage(): void {
    const state = app.store.getState();
    const dataUrl = renderConstructionPlan(state, { preset: "partner", simplify: true, dims: false, inventory: false });
    void sharePng(dataUrl, pngFilename(state.name, "夥伴觀看圖")).then((how) => {
      if (how !== "cancelled") app.notifyToast?.(how === "shared" ? "已開啟分享（可直接傳 LINE）" : "圖片已下載");
    });
  }

  function renderActions(): void {
    actions.innerHTML = "";
    const freshman = isFreshman();
    const layer = app.session.partner?.layer ?? "indoor";
    if (freshman) {
      if (layer !== "indoor") {
        actions.append(button("進入室內場佈", () => app.setPartnerLayer("indoor"), "btn partneraction partneraction--accent"));
      } else {
        actions.append(button("看校園位置", () => app.setPartnerLayer("campus"), "btn partneraction"));
      }
      actions.append(button("🖼 存成圖", sharePartnerImage, "btn partneraction"));
      const detail = app.session.partner?.infoLayer === "detail";
      actions.append(button(detail ? "只要方向" : "看尺寸說明", () => {
        app.setPartnerInfoLayer(detail ? "essential" : "detail");
        openSheet("steps");
      }, "btn partneraction"));
      return;
    }
    actions.append(
      button("▶ 開始彩排", () => {
        app.runRehearsal();
        openSheet("timeline");
      }, "btn partneraction"),
      button("✦ 更順的排法", () => {
        void app.requestPartnerSuggestion();
        openSheet("suggest");
      }, "btn partneraction partneraction--accent"),
      button("🖼 存成圖", sharePartnerImage, "btn partneraction"),
    );
  }

  function renderSteps(): void {
    if (isFreshman()) {
      const g = app.freshmanGuide();
      sheetTitle.textContent = "怎麼走到教室、進門後往哪裡";
      sheetBody.innerHTML = "";
      const list = el("ol", { class: "partnersteps" });
      for (const step of g.steps) {
        list.append(el("li", { class: "partnerstep" }, [
          el("span", { class: "partnerstep__no", text: String(step.index) }),
          el("span", { text: step.text }),
        ]));
      }
      sheetBody.append(list);
      if (app.session.partner?.infoLayer === "detail") {
        const project = app.store.getState();
        const pending = venueNeedsCalibration(project) ? calibrationPendingLabels(project) : [];
        sheetBody.append(el("p", {
          class: "partnerempty",
          text: pending.length
            ? `尺寸還待現場校正：${pending.join("、")}。先用方向，不要把畫面上的格子當成實測。`
            : "尺寸已在現場對過。日常帶路還是看入口、區域與下一步。",
        }));
      }
      if (g.photos.length) {
        sheetBody.append(button("看場地照片參考", () => openSheet("photos"), "btn btn--ghost"));
      }
      return;
    }
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

  function renderPhotos(): void {
    const g = app.freshmanGuide();
    sheetTitle.textContent = "場地照片參考";
    sheetBody.innerHTML = "";
    if (!g.photos.length) {
      sheetBody.append(el("p", { class: "partnerempty", text: "目前沒有綁定的場地照片。" }));
      return;
    }
    for (const photo of g.photos) {
      sheetBody.append(el("figure", { class: "campusphoto campusphoto--sheet" }, [
        el("img", { class: "campusphoto__img", src: photo.thumbnail, alt: photo.title }),
        el("figcaption", { class: "campusphoto__cap" }, [
          el("strong", { text: photo.title }),
          el("span", { text: `${photo.capturedToward} · ${photo.visibleFixtures.join("、")}` }),
          el("span", { class: "campusphoto__tag", text: photo.status === "unbound" ? "照片場地尚未綁定" : "待現場確認" }),
          el("span", { text: photo.note }),
        ]),
      ]));
    }
  }

  function renderStation(): void {
    const objectId = app.session.partner?.stationObjectId ?? null;
    const guide = objectId ? app.propAnchorGuide(objectId) : null;
    sheetTitle.textContent = guide ? `📍 ${guide.name}：大家站哪裡` : "📍 這個位置";
    sheetBody.innerHTML = "";
    if (!guide) {
      sheetBody.append(el("p", { class: "partnerempty", text: "點場地上的互動關卡（骰子、轉盤、抽卡箱…）就會告訴你站位。" }));
      return;
    }
    const list = el("ol", { class: "partnersteps" });
    for (const line of guide.lines) {
      list.append(el("li", { class: "partnerstep" }, [
        el("span", { class: "partnerstep__no", text: line.icon }),
        el("span", { text: line.text }),
      ]));
    }
    sheetBody.append(list);
    const now = objectId ? app.propStationNow(objectId) : null;
    if (now?.result) {
      sheetBody.append(el("p", { class: "partnerempty", text: `剛剛骰到：${now.result}${now.doing ? `,現在${now.doing}` : ""}` }));
    }
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
      sheetBody.append(el("p", { class: "partnerempty", text: "按「▶ 開始彩排」就會看到現場的時間軸。" }));
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
    const partner = app.session.partner;
    const freshman = partner?.audience === "freshman";
    const layer = partner?.layer ?? "indoor";
    const place = resolveProjectPlace(state);
    if (freshman && place && place.campusId !== "cyber" && !mapCampusTouched) {
      mapCampus = place.campusId;
      mapCampusTouched = true;
    }
    if (!partner) mapCampusTouched = false;

    title.textContent = freshman
      ? app.freshmanGuide().headline
      : (state.name || "活動場佈");

    const status = app.partnerStatus();
    const tone = TONE_LIGHT[status.tone] ?? TONE_LIGHT.ok;
    light.className = `partnerbar__light ${tone.cls}`;
    light.textContent = `${tone.dot} ${status.text}`;
    light.style.display = freshman ? "none" : "";
    splitBtn.style.display = freshman ? "" : "none";
    splitBtn.setAttribute("aria-pressed", String(!!partner?.splitView));
    splitBtn.textContent = partner?.splitView ? "取消分割" : "分割";

    layers.querySelectorAll<HTMLButtonElement>(".layerchip").forEach((chip) =>
      chip.setAttribute("aria-selected", String(chip.dataset.layer === layer)));
    layers.style.display = freshman ? "" : "none";
    roles.style.display = freshman ? "none" : "";
    roles.querySelectorAll<HTMLButtonElement>(".rolechip").forEach((chip) =>
      chip.setAttribute("aria-pressed", String(chip.dataset.role === (partner?.role ?? "all"))));

    const root = document.getElementById("app");
    if (root) {
      root.dataset.partnerLayer = layer;
      root.dataset.partnerAudience = partner?.audience ?? "";
      root.dataset.partnerSplit = partner?.splitView ? "1" : "0";
    }

    renderBrief();
    renderActions();

    const mapOn = showMap();
    campusMap.root.classList.toggle("is-on", mapOn);
    campusMap.root.classList.toggle("is-split", !!partner?.splitView);
    campusMap.root.hidden = !mapOn;
    if (mapOn) {
      campusMap.setState({
        campusId: mapCampus,
        place,
        layer,
      });
      campusMap.invalidate();
    }

    const tapped = partner?.stationObjectId ?? null;
    const tick = partner?.stationTap ?? 0;
    if (!freshman && tapped && tick !== shownTap) sheetKind = "station";
    else if (!tapped && sheetKind === "station") sheetKind = "none";
    shownTap = tick;

    sheet.style.display = sheetKind === "none" ? "none" : "flex";
    sheetFoot.style.display = "none";
    if (sheetKind === "steps") renderSteps();
    else if (sheetKind === "marks") renderMarks();
    else if (sheetKind === "timeline") renderTimeline();
    else if (sheetKind === "suggest") renderSuggest();
    else if (sheetKind === "station") renderStation();
    else if (sheetKind === "photos") renderPhotos();

    const hint = actions.querySelector(".partneraction");
    if (!freshman && hint instanceof HTMLElement && (hint.textContent ?? "").includes("彩排")) {
      hint.textContent = app.session.simResult ? "▶ 再彩排一次" : "▶ 開始彩排";
    }
  }

  return {
    top,
    dock,
    sheet,
    map: campusMap.root,
    update: render,
    openSheet,
    closeSheet,
    currentSheet: () => sheetKind,
  };
}
