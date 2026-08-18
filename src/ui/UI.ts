import { App, type Workflow } from "../app/App";
import { metersToCm, type SnapMode } from "../core/units";
import type { MeasurementType, RouteType, ViewName } from "../core/model";
import { calibrationCompare } from "../core/measure";
import { buildSummaryLines } from "../core/summary";
import { ROUTE_PRESETS } from "../core/routes";
import { issueCounts, type Severity } from "../core/validation";
import { renderConstructionPlan, type PageOrientation, type PageSize, type PlanPreset } from "../export/constructionPlan";
import { downloadPng, exportProjectJson, importProjectJson } from "../export/exporters";
import { buildInspector } from "./inspector";
import { buildLibrary, buildPlacementToolbar } from "./library";
import { buildQuickAgentSheet, type QuickAgentSheetHandles } from "./quickAgentSheet";
import { buildCustomAssetFlow } from "./customAssetFlow";
import { button, el, num, section, selectField, textField } from "./dom";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "top", label: "俯視" }, { id: "iso", label: "等角(3D)" }, { id: "front", label: "正視" },
  { id: "left", label: "左視" }, { id: "right", label: "右視" },
];
const SNAPS: { id: SnapMode; label: string }[] = [
  { id: "off", label: "自由" }, { id: "intersection", label: "交點" }, { id: "edge", label: "邊線" },
  { id: "center", label: "中心" }, { id: "half", label: "半格" },
];
const WORKFLOWS: { id: Workflow; label: string }[] = [
  { id: "site", label: "場地" }, { id: "layout", label: "場佈" }, { id: "route", label: "動線" },
  { id: "check", label: "檢查" }, { id: "export", label: "分享" },
];
const SEV_LABEL: Record<Severity, string> = { error: "錯誤", warning: "警告", info: "建議" };
const SEV_ICON: Record<Severity, string> = { error: "⛔", warning: "⚠", info: "ℹ" };

export class UI {
  private topbar = el("header", { class: "topbar" });
  private left = el("aside", { class: "left" });
  private right = el("aside", { class: "right" });
  private nav = el("nav", { class: "bottomnav" });
  private placebar = el("div", { class: "placebar-wrap", style: "display:none" });
  private measurebar = el("div", { class: "measurebar", style: "display:none" });
  private box = el("div", { class: "boxsel", style: "display:none" });
  private toast = el("div", { class: "toast", style: "display:none" });
  private teambar = el("div", { class: "teambar" });
  private ctxbar = el("div", { class: "ctxbar", style: "display:none" });
  private advanced = false;
  private mobilePropsOpen = false;
  private lastWorkflow: Workflow | null = null;
  private snapSel: HTMLSelectElement | null = null;
  private toastTimer: number | null = null;
  private planOpts = { preset: "full" as PlanPreset, page: "a4" as PageSize, orientation: "landscape" as PageOrientation, dims: true, inventory: true, simplify: false };
  private agentSheet: QuickAgentSheetHandles | null = null;
  private smartBox = el("div", { class: "list" });
  private simBox = el("div", { class: "readout" });
  private participants = 30;
  constructor(private app: App, private root: HTMLElement) {
    root.append(this.topbar, this.left, this.right, this.nav, this.placebar, this.measurebar, this.box, this.toast, this.teambar, this.ctxbar);
    this.buildTopbar();
    this.buildNav();
    this.placebar.append(buildPlacementToolbar(app));
    this.app.onBox = (rect) => this.renderBox(rect);
    this.app.onToast = (msg, undo) => this.showToast(msg, undo);
    this.app.notifyToast = (msg, undo) => this.showToast(msg, undo);
    this.app.onChange(() => this.update());
    this.bindKeys();
    this.agentSheet = buildQuickAgentSheet(app);
    root.append(this.agentSheet.root);
    this.update();
    this.buildQuickStart();
  }

  private buildQuickStart(): void {
    const KEY = "planform-iso:quickstart";
    try { if (localStorage.getItem(KEY)) return; } catch { return; }
    const steps = [
      "① 場地：設定教室尺寸與地磚，放門 / 投影幕",
      "② 場佈：建立功能區，輸入人數自動排地墊，放桌椅",
      "③ 動線：選類型畫人流，可「聚焦」或「▶ 模擬動線」",
      "④ 分享：匯出場佈總覽 / 動線圖 / 夥伴任務圖，或按「檢視給團隊」",
    ];
    const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } overlay.remove(); };
    const overlay = el("div", { class: "quickstart" }, [
      el("div", { class: "quickstart__card" }, [
        el("div", { class: "quickstart__title", text: "平面場 ISO — 三步驟快速上手" }),
        el("div", { class: "quickstart__steps" }, steps.map((s) => el("div", { text: s }))),
        el("p", { class: "hint", text: "手機：下方分頁切換場地 / 場佈 / 動線 / 分享；再點同一分頁可收回、露出畫布。" }),
        button("開始使用", dismiss),
      ]),
    ]);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
    this.root.append(overlay);
  }

  private isMobile(): boolean {
    return window.matchMedia("(max-width: 820px)").matches;
  }

  private showToast(msg: string, undo = false): void {
    this.toast.innerHTML = "";
    this.toast.append(el("span", { text: msg }));
    if (undo) this.toast.append(button("復原", () => this.app.undo(), "chip chip--sm"));
    this.toast.style.display = "flex";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { this.toast.style.display = "none"; }, 4000);
  }

  private buildTopbar(): void {
    const history = el("div", { class: "group" }, [
      button("↶", () => this.app.undo(), "chip"), button("↷", () => this.app.redo(), "chip"),
    ]);
    const views = el("div", { class: "group", "data-group": "views" },
      VIEWS.map((v) => button(v.label, () => this.app.setView(v.id), "chip chip--sm")));
    const flows = el("div", { class: "group group--flows", "data-group": "flows" },
      WORKFLOWS.map((w) => button(w.label, () => this.app.setWorkflow(w.id), "chip")));
    const snapSel = el("select", { class: "field__input field__input--inline desktop-only", title: "吸附模式" }) as HTMLSelectElement;
    for (const sn of SNAPS) snapSel.append(el("option", { value: sn.id, text: `吸附：${sn.label}` }));
    snapSel.value = this.app.session.snap;
    snapSel.addEventListener("change", () => this.app.setSnap(snapSel.value as SnapMode));
    this.snapSel = snapSel;
    const more = el("div", { class: "group", "data-group": "view2" }, [
      button("名稱", () => this.app.setShowLabels(!this.app.session.showLabels), "chip chip--sm"),
      button("置中", () => this.app.recenterView(), "chip chip--sm desktop-only"),
      snapSel,
      button("✦ AI", () => this.agentSheet?.open(), "chip chip--sm chip--accent"),
    ]);
    const viewToggle = button("視角", () => {
      this.app.setView(this.app.store.getState().view === "top" ? "iso" : "top");
    }, "chip mobile-only");
    const team = button("檢視給團隊", () => this.app.setTeamView(true), "chip chip--primary");
    this.topbar.append(el("div", { class: "topbar__title", text: "平面場 ISO" }), history, flows, views, more, viewToggle, team);
  }

  private buildNav(): void {
    const items: { w: Workflow; label: string; icon: string }[] = [
      { w: "site", label: "場地", icon: "▦" }, { w: "layout", label: "場佈", icon: "▤" },
      { w: "route", label: "動線", icon: "↝" }, { w: "check", label: "檢查", icon: "✓" },
      { w: "export", label: "分享", icon: "↗" },
    ];
    this.nav.append(...items.map((it) =>
      el("button", { type: "button", class: "navbtn", "data-nav": it.w }, [
        el("span", { class: "navbtn__icon", text: it.icon }), el("span", { text: it.label }),
      ])));
    this.nav.querySelectorAll<HTMLButtonElement>(".navbtn").forEach((b) =>
      b.addEventListener("click", () => {
        const w = b.dataset.nav as Workflow;
        // Re-tapping the active tab collapses the sheet back to full Canvas.
        if (this.app.session.workflow === w && this.root.classList.contains("show-left")) {
          this.root.classList.remove("show-left");
          return;
        }
        this.app.setWorkflow(w);
        this.root.classList.add("show-left");
      }));
  }

  // --- left panel (workflow-driven) --------------------------------------

  private rebuildLeft(): void {
    this.left.innerHTML = "";
    const wf = this.app.session.workflow;
    if (wf === "site") this.left.append(
      this.areaSection(), this.tileSection(), this.calibrationSection(),
      el("p", { class: "hint", text: "門 / 開關 / 投影幕會自動吸附牆面；門可設定開向與開門弧。" }),
      buildLibrary(this.app, { categories: ["fixture"] }),
    );
    else if (wf === "layout") this.left.append(
      this.smartLayoutSection(),
      buildCustomAssetFlow(this.app),
      buildLibrary(this.app, { categories: ["furniture", "equipment", "floor", "service", "custom"], zones: true, arrays: true }),
    );
    else if (wf === "route") this.left.append(this.routeSection());
    else if (wf === "check") this.left.append(this.validationSection());
    else if (wf === "export") this.left.append(this.exportSection());
  }

  private areaSection(): HTMLElement {
    const s = this.app.store.getState();
    const body: HTMLElement[] = [];
    for (const id of ["classroom", "corridor"] as const) {
      const a = s[id];
      body.push(el("div", { class: "subhead", text: a.name }), el("div", { class: "grid2" }, [
        num("長 (m)", a.length, 0.1, (v) => this.app.updateArea(id, { length: v }), 0.5),
        num("寬 (m)", a.width, 0.1, (v) => this.app.updateArea(id, { width: v }), 0.5),
        num("X (m)", a.x, 0.1, (v) => this.app.updateArea(id, { x: v })),
        num("Z (m)", a.z, 0.1, (v) => this.app.updateArea(id, { z: v })),
      ]));
    }
    return section("教室 / 走廊", body);
  }

  private tileSection(): HTMLElement {
    const t = this.app.store.getState().tile;
    return section("地磚", [
      el("div", { class: "grid2" }, [
        num("寬 (cm)", metersToCm(t.width), 1, (v) => this.app.updateTile({ width: v / 100 }), 1),
        num("深 (cm)", metersToCm(t.depth), 1, (v) => this.app.updateTile({ depth: v / 100 }), 1),
        num("原點 X (m)", t.originX, 0.05, (v) => this.app.updateTile({ originX: v })),
        num("原點 Z (m)", t.originZ, 0.05, (v) => this.app.updateTile({ originZ: v })),
        num("旋轉 (°)", t.rotationDeg, 1, (v) => this.app.updateTile({ rotationDeg: v })),
      ]),
      el("div", { class: "row wrap" }, [30, 40, 60].map((cm) =>
        button(`${cm}×${cm}`, () => this.app.updateTile({ width: cm / 100, depth: cm / 100 }), "chip chip--sm"))),
      button("顯示 / 隱藏格線", () => this.app.updateTile({ visible: !this.app.store.getState().tile.visible }), "btn btn--ghost"),
    ]);
  }

  private calibrationSection(): HTMLElement {
    const s = this.app.store.getState();
    const measured = this.app.getCalibrationDistance();
    const actual = el("input", { type: "number", step: "1", class: "field__input", placeholder: "實際 (cm)" }) as HTMLInputElement;
    const readout = el("div", { class: "readout" });
    const compare = () => {
      readout.innerHTML = "";
      const modelM = measured ?? s.tile.width;
      readout.append(el("div", { text: `模型量得：${(modelM * 100).toFixed(0)} cm` }));
      const cm = parseFloat(actual.value);
      if (cm) {
        const c = calibrationCompare(cm / 100, modelM);
        readout.append(el("div", { text: c.matches ? "✓ 與模型一致" : `差異：${(c.deltaMeters * 100).toFixed(1)} cm (${c.deltaPct.toFixed(1)}%)` }));
        readout.append(el("div", { class: "hint", text: "「套用到地磚 / 教室長」會改動既有場佈比例，可用復原還原。" }));
        readout.classList.toggle("readout--warn", !c.matches);
      }
    };
    actual.addEventListener("input", compare);
    compare();

    const body: HTMLElement[] = [
      el("p", { class: "hint", text: "① 在畫布點兩個已知距離的端點 ② 輸入實際長度 ③ 選擇套用方式。" }),
      this.app.session.mode === "calibrate"
        ? button("重新選點（校正中…）", () => this.app.startCalibration(), "btn btn--primary")
        : button("在畫布選兩點", () => this.app.startCalibration()),
    ];
    body.push(
      el("label", { class: "field" }, [el("span", { class: "field__label", text: "實際長度 (cm)" }), actual]),
      readout,
      el("div", { class: "row wrap" }, [
        button("記錄結果", () => this.applyCalib("record", actual)),
        button("套用到地磚", () => this.applyCalib("tile", actual), "btn btn--ghost"),
        button("套用到教室長", () => this.applyCalib("classroom-length", actual), "btn btn--ghost"),
      ]),
    );
    return section("現場校正精靈", body);
  }

  private applyCalib(action: "record" | "tile" | "classroom-length", input: HTMLInputElement): void {
    const cm = parseFloat(input.value);
    if (!cm) { this.showToast("請先輸入實際長度"); return; }
    this.app.applyCalibration(action, cm / 100);
  }

  private smartLayoutSection(): HTMLElement {
    const pIn = el("input", { type: "number", step: "1", value: this.participants, class: "field__input" }) as HTMLInputElement;
    pIn.addEventListener("change", () => { this.participants = Math.max(1, Math.round(parseFloat(pIn.value) || 0)); });
    return section("人數場佈（地墊排列器）", [
      el("p", { class: "hint", text: "輸入人數，系統依空間與走道自動產生地墊方案。先選一個小區域可排在區域內。" }),
      el("div", { class: "row" }, [
        el("label", { class: "field" }, [el("span", { class: "field__label", text: "人數" }), pIn]),
        button("產生方案", () => this.app.computeMatCandidates(this.participants)),
      ]),
      this.smartBox,
    ]);
  }

  private updateSmartBox(): void {
    this.smartBox.innerHTML = "";
    const cands = this.app.session.matCandidates;
    if (!cands.length) { this.smartBox.append(el("span", { class: "hint", text: "尚未產生方案。" })); return; }
    for (const c of cands) {
      const warn = c.warnings.length ? ` ⚠ ${c.warnings.join("、")}` : " ✓ 可放置";
      this.smartBox.append(el("div", { class: `card smart ${c.fits ? "" : "smart--warn"}` }, [
        el("span", { class: "card__body" }, [
          el("span", { class: "card__title", text: `${c.label}（${c.count} 張）` }),
          el("span", { class: "card__sub", text: `${c.footprint.width.toFixed(1)} × ${c.footprint.depth.toFixed(1)} m${warn}` }),
        ]),
        button("套用", () => this.app.applyMatCandidate(c.id), "chip chip--sm chip--primary"),
      ]));
    }
  }

  private routeSection(): HTMLElement {
    const s = this.app.store.getState();
    const list = el("div", { class: "list" });
    for (const r of s.routes) {
      const focused = this.app.session.focusRouteId === r.id;
      list.append(el("div", { class: "list__row" }, [
        el("span", { text: `${r.name}（${r.points.length} 點）` }),
        button(this.app.session.activeRouteId === r.id ? "繪製中" : "編輯", () => this.app.editRoute(r.id), "chip chip--sm"),
        button(focused ? "取消聚焦" : "聚焦", () => this.app.setRouteFocus(focused ? null : r.id), focused ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button("刪除", () => { this.app.setSelection([r.id]); this.app.deleteSelection(); }, "chip chip--sm chip--danger"),
      ]));
    }
    if (!s.routes.length) list.append(el("span", { class: "hint", text: "尚無動線。選一個類型開始畫。" }));

    const presetRow = el("div", { class: "row wrap" }, ROUTE_PRESETS.map((p) =>
      button(`${p.icon} ${p.label.replace("動線", "")}`, () => this.app.newRoutePreset(p.type as RouteType), "chip chip--sm")));

    const sim = this.app.session.simPlaying
      ? button("停止模擬", () => this.app.stopSimulation(), "btn btn--primary")
      : button("▶ 模擬動線", () => this.app.startSimulation());

    return section("動線", [
      el("p", { class: "hint", text: "選類型 → 在畫布點地面加入節點（起點綠、終點紅、含步驟編號）；可拖曳節點。" }),
      presetRow,
      el("div", { class: "row" }, [button("完成繪製", () => this.app.finishRoute(), "btn btn--ghost")]),
      list,
      el("div", { class: "subhead", text: "模擬活動流程" }),
      sim,
      this.simBox,
    ]);
  }

  private updateSimBox(): void {
    this.simBox.innerHTML = "";
    if (!this.app.session.simPlaying) { this.simBox.append(el("span", { class: "hint", text: "按「模擬動線」用小圓點沿動線移動，找出壅塞與交叉。" })); return; }
    const bn = this.app.session.bottlenecks.length;
    this.simBox.append(el("div", { text: `移動中人數：${this.app.session.simPositions.length}` }));
    this.simBox.append(el("div", { text: bn ? `⚠ 偵測到 ${bn} 處可能壅塞` : "目前無明顯壅塞" }));
    this.simBox.classList.toggle("readout--warn", bn > 0);
  }

  private validationSection(): HTMLElement {
    const issues = this.app.session.issues;
    const counts = issueCounts(issues);
    const list = el("div", { class: "list" });
    for (const iss of issues) {
      const row = el("button", { type: "button", class: `issue issue--${iss.severity}` }, [
        el("span", { class: "issue__icon", text: SEV_ICON[iss.severity] }),
        el("span", {}, [
          el("strong", { text: `${SEV_LABEL[iss.severity]}·${iss.shortTitle}` }),
          el("div", { class: "issue__msg", text: iss.message }),
          ...(iss.suggestedAction ? [el("div", { class: "issue__hint", text: `建議：${iss.suggestedAction}` })] : []),
        ]),
      ]) as HTMLButtonElement;
      row.addEventListener("click", () => { this.app.focusIssue(iss); this.root.classList.remove("show-left"); });
      list.append(row);
    }
    if (!issues.length) list.append(el("span", { class: "hint", text: "目前沒有問題。修改場佈後會自動重新檢查。" }));

    const vs = this.app.store.getState().validationSettings;
    const settings = section("檢查規則（門檻可調）", [
      num("最低走道寬 (cm)", Math.round(vs.minAisleWidth * 100), 5, (v) => this.app.updateValidationSettings({ minAisleWidth: v / 100 }), 0),
      num("門前淨空 (cm)", Math.round(vs.doorFrontClearance * 100), 5, (v) => this.app.updateValidationSettings({ doorFrontClearance: v / 100 }), 0),
      num("地墊距牆 (cm)", Math.round(vs.matWallClearance * 100), 5, (v) => this.app.updateValidationSettings({ matWallClearance: v / 100 }), 0),
      el("div", { class: "row wrap" }, [
        button(vs.checkScreenView ? "✓ 檢查投影幕視線" : "投影幕視線", () => this.app.updateValidationSettings({ checkScreenView: !vs.checkScreenView }), vs.checkScreenView ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button(vs.checkZoneRouteIntrusion ? "✓ 檢查區域擋動線" : "區域擋動線", () => this.app.updateValidationSettings({ checkZoneRouteIntrusion: !vs.checkZoneRouteIntrusion }), vs.checkZoneRouteIntrusion ? "chip chip--sm chip--primary" : "chip chip--sm"),
      ]),
    ], false);

    return section("檢查中心", [
      el("div", { class: "row" }, [
        button("重新檢查", () => this.app.runValidation()),
        el("span", { class: "hint", text: `⛔ ${counts.error} · ⚠ ${counts.warning} · ℹ ${counts.info}` }),
      ]),
      list,
      settings,
    ]);
  }

  private exportSection(): HTMLElement {
    const state = () => this.app.store.getState();
    const importInput = el("input", { type: "file", accept: "application/json", style: "display:none" }) as HTMLInputElement;
    importInput.addEventListener("change", async () => {
      const f = importInput.files?.[0]; if (!f) return;
      try { this.app.store.loadProject(await importProjectJson(f) as never); } catch { alert("匯入失敗：JSON 格式錯誤"); }
      importInput.value = "";
    });
    const layoutName = el("input", { type: "text", placeholder: "命名平面圖", class: "field__input" }) as HTMLInputElement;
    const layoutList = el("select", { class: "field__input" }) as HTMLSelectElement;
    const refreshList = () => {
      const names = this.app.store.listLayouts(); const cur = layoutList.value;
      layoutList.innerHTML = "";
      layoutList.append(el("option", { value: "", text: names.length ? "選擇平面圖…" : "尚無已存平面圖" }));
      for (const n of names) layoutList.append(el("option", { value: n, text: n }));
      if (names.includes(cur)) layoutList.value = cur;
    };
    refreshList();
    const o = this.planOpts;
    const shot = (preset: PlanPreset, role: "report" | "life" | "guide" | null, name: string) =>
      downloadPng(renderConstructionPlan(state(), { ...o, preset, roleFilter: role }), `planform-${name}.png`);
    const planSection = section("分享給夥伴（圖片）", [
      el("p", { class: "hint", text: "輸出乾淨、可直接給工作人員看的圖，不含編輯控制點。" }),
      button("場佈總覽", () => shot("full", null, "overview")),
      button("動線圖", () => shot("route", null, "route"), "btn btn--ghost"),
      button("地墊圖", () => shot("mats", null, "mats"), "btn btn--ghost"),
      el("div", { class: "subhead", text: "夥伴任務圖（只顯示相關資訊）" }),
      el("div", { class: "row wrap" }, [
        button("報到組", () => shot("staff", "report", "report"), "chip chip--sm"),
        button("生活組", () => shot("staff", "life", "life"), "chip chip--sm"),
        button("引導組", () => shot("staff", "guide", "guide"), "chip chip--sm"),
      ]),
      el("div", { class: "grid2" }, [
        selectField("紙張", [{ value: "a4", label: "A4" }, { value: "a3", label: "A3" }], o.page, (v) => { o.page = v as PageSize; }),
        selectField("方向", [{ value: "landscape", label: "橫式" }, { value: "portrait", label: "直式" }], o.orientation, (v) => { o.orientation = v as PageOrientation; }),
      ]),
      el("div", { class: "row wrap" }, [
        button(o.dims ? "✓ 尺寸標註" : "尺寸標註", () => { o.dims = !o.dims; this.update(); }, o.dims ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button(o.inventory ? "✓ 數量清單" : "數量清單", () => { o.inventory = !o.inventory; this.update(); }, o.inventory ? "chip chip--sm chip--primary" : "chip chip--sm"),
        button(o.simplify ? "✓ 簡化顯示" : "簡化顯示", () => { o.simplify = !o.simplify; this.update(); }, o.simplify ? "chip chip--sm chip--primary" : "chip chip--sm"),
      ]),
      button("3D 示意圖", () => downloadPng(this.app.scene.renderToDataURL(state(), "iso"), "planform-3d.png"), "btn btn--ghost"),
    ]);

    const measureSection = section("現場量測", [
      selectField("量測類型", [
        { value: "free-distance", label: "任意距離" }, { value: "object-gap", label: "物件間距" },
        { value: "wall-clearance", label: "到牆距離" }, { value: "aisle-width", label: "走道寬度" },
      ], this.app.session.measureType, (v) => this.app.setMeasureType(v as MeasurementType)),
      button("開始量測（端點自動吸附）", () => this.app.startMeasure(this.app.session.measureType)),
      this.measurementsList(),
    ]);

    return section("匯出 / 儲存", [
      planSection,
      measureSection,
      el("div", { class: "subhead", text: "資料" }),
      el("div", { class: "row" }, [
        button("匯出 JSON", () => exportProjectJson(state())),
        button("匯入 JSON", () => importInput.click(), "btn btn--ghost"),
      ]),
      importInput,
      el("div", { class: "subhead", text: "本機平面圖" }),
      textField("活動名稱", state().name, (v) => this.app.store.mutate((p) => (p.name = v), { history: false })),
      textField("簡短說明（團隊檢視顯示）", state().description, (v) => this.app.updateDescription(v)),
      el("div", { class: "row" }, [layoutName, button("儲存", () => { this.app.store.saveNamedLayout(layoutName.value.trim() || state().name); refreshList(); })]),
      el("div", { class: "row" }, [layoutList,
        button("載入", () => { if (layoutList.value) this.app.store.loadNamedLayout(layoutList.value); }, "btn btn--ghost"),
        button("刪除", () => { if (layoutList.value) { this.app.store.deleteNamedLayout(layoutList.value); refreshList(); } }, "btn btn--ghost")]),
    ]);
  }

  private measurementsList(): HTMLElement {
    const list = el("div", { class: "list" });
    const ms = this.app.store.getState().measurements;
    for (const m of ms) {
      const len = Math.hypot(m.end.x - m.start.x, m.end.z - m.start.z);
      list.append(el("div", { class: "list__row" }, [
        el("span", { text: `${(len * 100).toFixed(0)} cm` }),
        button(m.visible ? "顯示" : "隱藏", () => this.app.toggleMeasurementVisible(m.id), "chip chip--sm"),
        button("刪除", () => this.app.deleteMeasurement(m.id), "chip chip--sm chip--danger"),
      ]));
    }
    if (!ms.length) list.append(el("span", { class: "hint", text: "尚無保留的尺寸線。" }));
    return list;
  }

  // --- update ------------------------------------------------------------

  private update(): void {
    const sess = this.app.session;
    const s = this.app.store.getState();
    setPressed(this.topbar, "views", (b) => VIEWS[b].id === s.view);
    setPressed(this.topbar, "flows", (b) => WORKFLOWS[b].id === sess.workflow);
    setPressed(this.topbar, "view2", (b) => (b === 0 ? sess.showLabels : false));
    if (this.snapSel && document.activeElement !== this.snapSel) this.snapSel.value = sess.snap;
    this.nav.querySelectorAll<HTMLButtonElement>(".navbtn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.nav === sess.workflow)));

    if (this.lastWorkflow !== sess.workflow || sess.workflow === "check" || sess.workflow === "route" || sess.workflow === "site" || sess.workflow === "export") {
      this.lastWorkflow = sess.workflow;
      this.rebuildLeft();
    }

    // Smart layout + simulation live boxes.
    this.updateSmartBox();
    this.updateSimBox();

    // Team / partner view overlay.
    this.updateTeamView();

    // Inspector vs mobile context bar.
    const hasSel = sess.selection.size > 0;
    if (!hasSel) this.mobilePropsOpen = false;
    const mobile = this.isMobile();
    this.right.innerHTML = "";
    if (hasSel && mobile && this.mobilePropsOpen) {
      this.right.append(button("收起屬性", () => { this.mobilePropsOpen = false; this.update(); }, "btn btn--ghost"));
    }
    this.right.append(buildInspector(this.app, this.advanced, (v) => { this.advanced = v; this.update(); }));
    const showInspector = hasSel && (!mobile || this.mobilePropsOpen) && !sess.teamView;
    this.root.classList.toggle("show-inspector", showInspector);
    this.updateContextBar(hasSel && mobile && !this.mobilePropsOpen && !sess.teamView);

    // Placement + measure bars.
    this.placebar.style.display = sess.mode === "place" ? "flex" : "none";
    this.updateMeasureBar();
  }

  private updateContextBar(show: boolean): void {
    this.ctxbar.style.display = show ? "flex" : "none";
    if (!show) return;
    this.ctxbar.innerHTML = "";
    this.ctxbar.append(
      button("旋轉", () => this.app.rotateSelection(15), "chip"),
      button("複製", () => this.app.duplicateSelection(), "chip"),
      button("精調", () => { this.mobilePropsOpen = true; this.update(); }, "chip"),
      button("屬性", () => { this.mobilePropsOpen = true; this.update(); }, "chip chip--primary"),
    );
  }

  private updateTeamView(): void {
    const on = this.app.session.teamView;
    this.root.classList.toggle("team", on);
    this.teambar.innerHTML = "";
    if (!on) return;
    const s = this.app.store.getState();
    const legend = el("div", { class: "teambar__legend" });
    for (const z of s.zones) legend.append(el("span", { class: "teamchip" }, [el("span", { class: "sw", style: `background:${z.color}` }), el("span", { text: `${z.icon ?? ""}${z.name}` })]));
    for (const r of s.routes) legend.append(el("span", { class: "teamchip" }, [el("span", { class: "sw", style: `background:${r.color}` }), el("span", { text: r.name })]));
    this.teambar.append(
      el("div", { class: "teambar__head" }, [
        el("div", {}, [
          el("div", { class: "teambar__title", text: s.name || "活動場佈" }),
          el("div", { class: "teambar__desc", text: s.description || buildSummaryLines(s).slice(0, 2).join("　") }),
        ]),
        el("div", { class: "row" }, [
          button("分享圖", () => downloadPng(renderConstructionPlan(s, { preset: "full", simplify: true }), "planform-overview.png"), "chip"),
          button("退出檢視", () => this.app.setTeamView(false), "chip chip--primary"),
        ]),
      ]),
      legend,
    );
  }

  private updateMeasureBar(): void {
    const mode = this.app.session.mode;
    const on = mode === "measure" || mode === "calibrate";
    this.measurebar.style.display = on ? "flex" : "none";
    if (!on) return;
    this.measurebar.innerHTML = "";
    if (mode === "calibrate") {
      const d = this.app.getCalibrationDistance();
      this.measurebar.append(
        el("span", { class: "measurebar__text", text: d !== null ? `模型距離 ${d.toFixed(2)} m（回校正面板輸入實際值）` : "點兩個已知距離的端點" }),
        button("取消校正", () => this.app.cancelCalibration(), "chip chip--sm"),
      );
      return;
    }
    const r = this.app.getMeasureResult();
    const text = r
      ? `${r.meters.toFixed(2)} m · ${r.cm.toFixed(0)} cm · X ${r.dxCm.toFixed(0)} / Z ${r.dzCm.toFixed(0)} cm · 約 ${r.tilesDiagonal.toFixed(1)} 格`
      : "點兩個位置量距離（端點會自動吸附）";
    this.measurebar.append(
      el("span", { class: "measurebar__text", text }),
      button("保留", () => this.app.keepMeasurement(), "chip chip--sm chip--primary"),
      button("清除", () => this.app.clearMeasure(), "chip chip--sm"),
      button("完成", () => this.app.stopMeasure(), "chip chip--sm"),
    );
  }

  private renderBox(rect: { minX: number; minY: number; maxX: number; maxY: number } | null): void {
    if (!rect) { this.box.style.display = "none"; return; }
    this.box.style.display = "block";
    this.box.style.left = `${rect.minX}px`; this.box.style.top = `${rect.minY}px`;
    this.box.style.width = `${rect.maxX - rect.minX}px`; this.box.style.height = `${rect.maxY - rect.minY}px`;
  }

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "SELECT" || tgt.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z" && !e.shiftKey) { e.preventDefault(); this.app.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); this.app.redo(); }
      else if (e.key === "Escape") { this.app.cancelPlacement(); if (this.app.session.mode === "measure") this.app.stopMeasure(); if (this.app.session.mode === "calibrate") this.app.cancelCalibration(); }
      else if (e.key === "Delete" || e.key === "Backspace") this.app.deleteSelection();
      else if (k === "r") { if (this.app.session.mode === "place") this.app.rotateGhost(); else this.app.rotateSelection(15); }
      else if (k === "d") this.app.duplicateSelection();
      else if (e.key.startsWith("Arrow") && this.app.session.selection.size > 0) {
        e.preventDefault();
        const tile = this.app.store.getState().tile;
        const step = e.shiftKey ? tile.width : 0.05; // Shift = one tile, else 5cm
        const stepZ = e.shiftKey ? tile.depth : 0.05;
        if (e.key === "ArrowUp") this.app.nudgeSelection(0, -stepZ);
        else if (e.key === "ArrowDown") this.app.nudgeSelection(0, stepZ);
        else if (e.key === "ArrowLeft") this.app.nudgeSelection(-step, 0);
        else if (e.key === "ArrowRight") this.app.nudgeSelection(step, 0);
      }
    });
  }
}

function setPressed(root: HTMLElement, group: string, pred: (i: number) => boolean): void {
  const c = root.querySelector(`[data-group="${group}"]`);
  if (!c) return;
  Array.from(c.querySelectorAll("button")).forEach((b, i) => b.setAttribute("aria-pressed", String(pred(i))));
}
